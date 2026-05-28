/**
 * Teacher Agent — produces the user-facing reply.
 *
 * Phase 2: accepts optional { strategy, instruction } from the coordinator.
 *          When present, prepends a strategic directive to the system prompt
 *          that overrides the teacher's default tendency.
 *          When absent (legacy/test calls), behaves exactly like Phase 1.
 *
 * Model: gemini-2.5-flash (chat persona, speed).
 */

const { buildPrompt } = require('../tutor-style');
const llm = require('./adapters/llm_adapter');

const MODEL = 'gemini-2.5-flash';
const PROVIDER = 'gemini';

/**
 * @param {Object} args
 * @param {import('./schemas').Profile} args.profile
 * @param {import('./schemas').Book}    args.book
 * @param {import('./schemas').StoredMessage[]} args.recentMessages
 *        Includes the just-saved user message as the LAST entry.
 * @param {string} args.userMessage
 * @param {string} [args.strategy]     One of routing.STRATEGIES
 * @param {string} [args.instruction]  Short directive (Hebrew) from routing agent
 * @returns {Promise<{ replyText: string, meta: { model: string, historyLength: number, strategy: string|null } }>}
 */
async function respond({ profile, book, recentMessages, userMessage, strategy, instruction }) {
  const basePrompt = buildPrompt(profile, book);

  // ── Strategic directive ─────────────────────────────────────────────────────
  // When the coordinator provides a strategy, the instruction is prepended
  // *above* the existing buildPrompt. The directive is short and surgical;
  // it overrides the teacher's default verbose tendency for this turn only.
  const systemInstruction = instruction
    ? `## הוראת אסטרטגיה לתשובה הנוכחית (חובה לציית — גובר על כל ברירת מחדל אחרת)\n${instruction}\n\n---\n\n${basePrompt}`
    : basePrompt;

  // Build provider-shaped history (exclude the last user message — sent separately).
  let history = recentMessages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  while (history.length > 0 && history[0].role === 'model') {
    history.shift();
  }

  const replyText = await llm.chat({
    provider: PROVIDER,
    model: MODEL,
    systemInstruction,
    history,
    message: userMessage
  });

  return {
    replyText,
    meta: { model: MODEL, historyLength: history.length, strategy: strategy || null }
  };
}

module.exports = { respond, MODEL, PROVIDER };
