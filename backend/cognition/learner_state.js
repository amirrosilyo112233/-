/**
 * Learner-State Agent
 *
 * Tracks what the learner understands, what's shaky, and depth level.
 * Updated after each chat turn based on Anti-Pseudo signal.
 *
 * Schema: { understands_well: string[], shaky: string[], misconceptions: string[], current_depth: 0-3 }
 *
 * No LLM — pure DB reads/writes.
 */

const dbAdapter = require('./adapters/db_adapter');

/**
 * Get current learner state for a book.
 * Returns default empty state if none exists yet.
 */
async function get(bookId) {
  try {
    return await dbAdapter.getLearnerState(bookId);
  } catch (e) {
    return { book_id: bookId, understands_well: [], shaky: [], misconceptions: [], current_depth: 0 };
  }
}

/**
 * Update learner state based on the Anti-Pseudo result from the current turn.
 *
 * @param {number|string} bookId
 * @param {object} pseudo        { signal, depth, reason }
 * @param {string} currentTopic  What was being discussed (from book.current_chapter or routing)
 */
async function update(bookId, pseudo, currentTopic) {
  if (!pseudo || !bookId) return;
  try {
    const state = await get(bookId);

    const topic = (currentTopic || '').substring(0, 100);

    // Update arrays based on signal
    if (pseudo.signal === 'genuine' && pseudo.depth >= 2 && topic) {
      // Remove from shaky if it was there, add to understands_well
      state.shaky = state.shaky.filter(t => t !== topic);
      if (!state.understands_well.includes(topic)) {
        state.understands_well = [...state.understands_well.slice(-20), topic]; // keep last 20
      }
    } else if ((pseudo.signal === 'parrot' || pseudo.signal === 'evasion') && topic) {
      // Mark as shaky — not understood despite seeming so
      state.misconceptions = state.misconceptions.filter(t => t !== topic);
      if (!state.shaky.includes(topic)) {
        state.shaky = [...state.shaky.slice(-15), topic];
      }
    }

    // Update depth level (exponential moving average style)
    const depthDelta = pseudo.depth - state.current_depth;
    state.current_depth = Math.max(0, Math.min(3,
      state.current_depth + Math.round(depthDelta * 0.3)
    ));

    await dbAdapter.upsertLearnerState(bookId, state);
  } catch (e) {
    console.warn('[learner_state] update failed:', e.message);
  }
}

/**
 * Build a short context string for the teacher prompt.
 * Only included when there's meaningful state to share.
 */
function summarize(state) {
  if (!state) return '';
  const parts = [];
  if (state.understands_well?.length > 0) {
    parts.push(`הבין היטב: ${state.understands_well.slice(-5).join(', ')}`);
  }
  if (state.shaky?.length > 0) {
    parts.push(`עדיין שטחי: ${state.shaky.slice(-3).join(', ')}`);
  }
  return parts.length > 0 ? `[תיק לומד: ${parts.join(' | ')}]` : '';
}

module.exports = { get, update, summarize };
