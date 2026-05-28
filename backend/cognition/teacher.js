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

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEEP_MODEL = 'gemini-2.5-pro';
const PROVIDER = 'gemini';
// Back-compat export for older callers.
const MODEL = DEFAULT_MODEL;

/**
 * Decide which Gemini model to use for this turn.
 * Pro is used only when the upside justifies the latency cost (~3-5x slower).
 *
 * @param {Object} args
 * @param {import('./schemas').AntiPseudoResult} [args.pseudo]
 * @param {string} [args.userMessage]
 * @param {import('./schemas').StoredMessage[]} [args.recentMessages]
 * @returns {{ model: string, reason: string }}
 */
function pickModel({ pseudo, userMessage, recentMessages }) {
  // Genuine deep understanding — moments worth honoring with quality
  if (pseudo?.signal === 'genuine' && pseudo?.depth >= 3) {
    return { model: DEEP_MODEL, reason: 'genuine_deep' };
  }
  // First message of a new conversation — sets the tone
  if ((recentMessages?.length ?? 0) <= 1) {
    return { model: DEEP_MODEL, reason: 'first_turn' };
  }
  // Substantive long user message — probably worth a deeper reply
  if ((userMessage?.length ?? 0) > 250) {
    return { model: DEEP_MODEL, reason: 'long_substantive' };
  }
  // Default: fast routine
  return { model: DEFAULT_MODEL, reason: 'routine' };
}

/**
 * @param {Object} args
 * @param {import('./schemas').Profile} args.profile
 * @param {import('./schemas').Book}    args.book
 * @param {import('./schemas').StoredMessage[]} args.recentMessages
 *        Includes the just-saved user message as the LAST entry.
 * @param {string} args.userMessage
 * @param {string} [args.strategy]     One of routing.STRATEGIES
 * @param {string} [args.instruction]  Short directive (Hebrew) from routing agent
 * @param {import('./schemas').AntiPseudoResult} [args.pseudo]  Used to pick model
 * @param {string} [args.model]        Explicit override; if omitted, pickModel() decides
 * @returns {Promise<{ replyText: string, meta: { model: string, modelReason: string, historyLength: number, strategy: string|null } }>}
 */
async function respond({ profile, book, recentMessages, userMessage, strategy, instruction, pseudo, model }) {
  const basePrompt = buildPrompt(profile, book);
  const choice = model
    ? { model, reason: 'explicit_override' }
    : pickModel({ pseudo, userMessage, recentMessages });
  const useModel = choice.model;

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
    model: useModel,
    systemInstruction,
    history,
    message: userMessage
  });

  return {
    replyText,
    meta: {
      model: useModel,
      modelReason: choice.reason,
      historyLength: history.length,
      strategy: strategy || null
    }
  };
}

module.exports = { respond, pickModel, MODEL, DEFAULT_MODEL, DEEP_MODEL, PROVIDER };
