/**
 * Runtime Coordinator Agent — orchestration only.
 *
 * Responsibilities:
 *  - Receive a ChatRequest from the host
 *  - Call agents in the correct order
 *  - Emit events at each step
 *  - Return a ChatResponse
 *
 * NOT allowed:
 *  - calling Gemini directly (use teacher / llm_adapter)
 *  - holding state across requests
 *  - making content decisions
 *
 * Phase 1: pass-through. Only Teacher is invoked. Anti-Pseudo, Routing,
 *          LearnerState, KnowledgeMap are NOT_STARTED — to be inserted
 *          between "chat_received" and the teacher call in Phase 2 without
 *          changing this file's external contract.
 */

const teacher = require('./teacher');
const eventLog = require('./event_log');

/**
 * Handle a single chat turn.
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

  // ── Phase 2 hook points (currently no-ops) ────────────────────────────────
  //   const ks      = await knowledgeMap.query({ bookId, focus: userMessage });
  //   const state   = await learnerState.get({ bookId });
  //   const pseudo  = await antiPseudo.evaluate({ userMessage, lastTeacher, currentTopic });
  //   const route   = routing.decide({ pseudo, state, ks });
  // ──────────────────────────────────────────────────────────────────────────

  let replyText;
  const teacherStart = Date.now();
  eventLog.log({ type: 'teacher_invoked', bookId, agent: 'teacher', payload: { model: teacher.MODEL } });

  try {
    const result = await teacher.respond({ profile, book, recentMessages, userMessage });
    replyText = result.replyText;

    eventLog.log({
      type: 'teacher_replied',
      bookId,
      agent: 'teacher',
      payload: { replyLength: replyText.length, model: result.meta.model, historyLength: result.meta.historyLength },
      latencyMs: Date.now() - teacherStart
    });
  } catch (err) {
    eventLog.log({
      type: 'teacher_failed',
      bookId,
      agent: 'teacher',
      payload: { error: err.message },
      latencyMs: Date.now() - teacherStart
    });
    throw err; // propagate to host so HTTP error contract stays intact
  }

  eventLog.log({
    type: 'chat_completed',
    bookId,
    agent: 'coordinator',
    latencyMs: Date.now() - t0
  });

  return { reply: replyText };
}

module.exports = { handleChatMessage };
