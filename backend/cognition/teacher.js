/**
 * Teacher Agent — produces the user-facing reply.
 *
 * Phase 1: identical behavior to the previous inline Gemini call.
 *          System prompt: tutor-style.buildPrompt(profile, book).
 *          History: same trim-leading-'model' workaround.
 *          Model: gemini-2.5-flash.
 *
 * Phase 2: will accept a RoutingDecision (strategy + instruction) from the coordinator
 *          and use strategy-specific prompt templates from ./prompts/.
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
 * @returns {Promise<{ replyText: string, meta: { model: string, historyLength: number } }>}
 */
async function respond({ profile, book, recentMessages, userMessage }) {
  const systemInstruction = buildPrompt(profile, book);

  // Build provider-shaped history (exclude the last user message — sent separately).
  let history = recentMessages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  // Gemini requires the first history entry to be role 'user'.
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
    meta: { model: MODEL, historyLength: history.length }
  };
}

module.exports = { respond, MODEL, PROVIDER };
