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
      pseudo
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
