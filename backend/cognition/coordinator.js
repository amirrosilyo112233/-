/**
 * Runtime Coordinator Agent — orchestration only.
 *
 * Phase 2 flow:
 *   chat_received
 *   → anti_pseudo.evaluate           [pseudo_evaluated]
 *   → routing.decide                 [routing_decided]
 *   → teacher.respond(strategy)      [teacher_invoked → teacher_replied]
 *   → chat_completed
 *
 * Failure isolation:
 *   - anti_pseudo errors fall back to { partial, depth=1 } (handled inside anti_pseudo)
 *   - routing is deterministic, cannot fail
 *   - teacher errors propagate (returned as HTTP 500 by host)
 */

const antiPseudo = require('./anti_pseudo');
const routing = require('./routing');
const teacher = require('./teacher');
const eventLog = require('./event_log');
const knowledgeMap = require('./knowledge_map');
const learnerState = require('./learner_state');
const dbAdapter = require('./adapters/db_adapter');

/**
 * @param {import('./schemas').ChatRequest} req
 * @returns {Promise<import('./schemas').ChatResponse>}
 */
async function handleChatMessage(req) {
  const { bookId, userMessage, profile, book, recentMessages } = req;
  const t0 = Date.now();

  eventLog.log({
    type: 'chat_received',
    bookId,
    agent: 'coordinator',
    payload: { messageLength: (userMessage || '').length, historyCount: (recentMessages || []).length }
  });

  // ── 0a. RAG: retrieve relevant book chunks if indexed ────────────────────
  let relevantChunks = [];
  if (book?.indexed_at) {
    try {
      const ragResult = await knowledgeMap.query(bookId, userMessage);
      if (ragResult.found) {
        relevantChunks = ragResult.chunks;
        eventLog.log({
          type: 'rag_retrieved',
          bookId,
          agent: 'knowledge_map',
          payload: { chunksFound: relevantChunks.length, queryLength: (userMessage || '').length }
        });
      }
    } catch (e) {
      console.warn('[coordinator] RAG query failed, falling back to full content:', e.message);
    }
  }

  // ── 0b. Learner-State: load current understanding profile ───────────────
  let stateSnapshot = null;
  try {
    stateSnapshot = await learnerState.get(bookId);
  } catch (e) {
    console.warn('[coordinator] learner_state get failed:', e.message);
  }

  // ── 0c. Session restart detection ────────────────────────────────────────
  // If > 4 hours since the last assistant message → flag a "session restart".
  // The teacher will open with "last time we were on X — continue or new?"
  let sessionContext = null;
  try {
    const msgs = recentMessages || [];
    // walk backward from last (current user msg) — find most recent assistant msg
    let lastAssistantMsg = null;
    for (let i = msgs.length - 2; i >= 0; i--) {
      if (msgs[i].role === 'assistant') { lastAssistantMsg = msgs[i]; break; }
    }
    if (lastAssistantMsg?.created_at) {
      const gapMs = Date.now() - new Date(lastAssistantMsg.created_at).getTime();
      const FOUR_HOURS = 4 * 60 * 60 * 1000;
      if (gapMs > FOUR_HOURS) {
        const hours = Math.round(gapMs / (60 * 60 * 1000));
        sessionContext = {
          isRestart: true,
          hoursSinceLast: hours,
          gapLabel: hours < 24 ? `לפני ${hours} שעות` : (hours < 48 ? 'אתמול' : `לפני ${Math.round(hours/24)} ימים`),
          lastTeacherSnippet: (lastAssistantMsg.content || '').substring(0, 400)
        };
        eventLog.log({
          type: 'session_restart',
          bookId,
          agent: 'coordinator',
          payload: { hoursSinceLast: hours }
        });
      }
    }
  } catch (e) {
    console.warn('[coordinator] session restart detection failed:', e.message);
  }

  // ── 0d. Recent field log entries (background context) ───────────────────
  let recentFieldEntries = [];
  try {
    const allLogs = await dbAdapter.getRecentFieldLog ? await dbAdapter.getRecentFieldLog(5) : [];
    recentFieldEntries = allLogs.filter(l => !l.book_id || l.book_id === parseInt(bookId)).slice(0, 3);
  } catch (e) {
    console.warn('[coordinator] field log fetch failed:', e.message);
  }

  // ── 1. Anti-Pseudo: classify the user's message ───────────────────────────
  // Find the most recent assistant message in history (the prior teacher turn).
  // recentMessages includes the just-saved user message as the LAST entry,
  // so we walk backward from index length-2 looking for role === 'assistant'.
  let lastTeacherMessage = null;
  for (let i = (recentMessages || []).length - 2; i >= 0; i--) {
    if (recentMessages[i].role === 'assistant') {
      lastTeacherMessage = recentMessages[i].content;
      break;
    }
  }

  const pseudo = await antiPseudo.evaluate({
    userMessage,
    lastTeacherMessage,
    currentTopic: book?.current_chapter || null
  });

  eventLog.log({
    type: 'pseudo_evaluated',
    bookId,
    agent: 'anti_pseudo',
    payload: {
      signal: pseudo.signal,
      depth: pseudo.depth,
      reason: pseudo.reason,
      model: antiPseudo.MODEL,
      deterministic: pseudo.deterministic || false,
      fallback: pseudo.fallback || false,
      error: pseudo.error || null
    },
    latencyMs: pseudo.durationMs
  });

  // ── 2. Routing: deterministic strategy decision ───────────────────────────
  // userMessage is passed so RICH_TEACHING can detect long, open questions.
  const decision = routing.decide({ pseudo, userMessage });

  eventLog.log({
    type: 'routing_decided',
    bookId,
    agent: 'routing',
    payload: { strategy: decision.strategy, ruleId: decision.ruleId, signal: pseudo.signal, depth: pseudo.depth }
  });

  // ── 3. Teacher: generate the reply, guided by the strategy + hybrid model ─
  const teacherStart = Date.now();
  // Pre-compute model choice for the invocation event (teacher will redo this
  // internally, but emitting upfront makes telemetry order intuitive).
  const modelChoice = teacher.pickModel({ pseudo, userMessage, recentMessages });
  eventLog.log({
    type: 'teacher_invoked',
    bookId,
    agent: 'teacher',
    payload: {
      model: modelChoice.model,
      modelReason: modelChoice.reason,
      strategy: decision.strategy
    }
  });

  let replyText;
  try {
    const result = await teacher.respond({
      profile, book, recentMessages, userMessage,
      strategy: decision.strategy,
      instruction: decision.instruction,
      pseudo,
      relevantChunks,
      learnerState: stateSnapshot,
      sessionContext,       // {isRestart, hoursSinceLast, gapLabel, lastTeacherSnippet}
      recentFieldEntries    // last 3 field log entries for context awareness
    });
    replyText = result.replyText;

    eventLog.log({
      type: 'teacher_replied',
      bookId,
      agent: 'teacher',
      payload: {
        replyLength: replyText.length,
        model: result.meta.model,
        modelReason: result.meta.modelReason,
        historyLength: result.meta.historyLength,
        strategy: result.meta.strategy
      },
      latencyMs: Date.now() - teacherStart
    });
  } catch (err) {
    eventLog.log({
      type: 'teacher_failed',
      bookId,
      agent: 'teacher',
      payload: { error: err.message, strategy: decision.strategy, model: modelChoice.model },
      latencyMs: Date.now() - teacherStart
    });
    throw err;
  }

  // ── Update Learner-State (fire-and-forget) ────────────────────────────────
  learnerState.update(bookId, pseudo, book?.current_chapter || decision.strategy);

  eventLog.log({
    type: 'chat_completed',
    bookId,
    agent: 'coordinator',
    latencyMs: Date.now() - t0,
    payload: { strategy: decision.strategy, signal: pseudo.signal }
  });

  return { reply: replyText };
}

module.exports = { handleChatMessage };
