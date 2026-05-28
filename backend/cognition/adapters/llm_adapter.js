/**
 * LLM Adapter — unified interface across providers.
 * The ONLY file inside cognition/ allowed to require an LLM SDK.
 *
 * Phase 1: Gemini only (chat + generate).
 * Phase 2: add OpenAI (gpt-4o-mini for Anti-Pseudo + text-embedding-3 for embeddings).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let _gemini = null;
function gemini() {
  if (!_gemini) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not set');
    }
    _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _gemini;
}

/**
 * Multi-turn chat call.
 * @param {Object} args
 * @param {'gemini'} args.provider
 * @param {string}   args.model               e.g. 'gemini-2.5-flash'
 * @param {string}   [args.systemInstruction]
 * @param {Array}    [args.history]           Provider-shaped history (caller's responsibility)
 * @param {string}   args.message
 * @returns {Promise<string>}
 */
async function chat({ provider, model, systemInstruction, history = [], message }) {
  if (provider === 'gemini') {
    const m = gemini().getGenerativeModel({ model, systemInstruction });
    const session = m.startChat({ history });
    const result = await session.sendMessage(message);
    return result.response.text();
  }
  throw new Error(`llm_adapter.chat: provider not implemented: ${provider}`);
}

/**
 * Single-shot completion.
 * @param {Object} args
 * @param {'gemini'} args.provider
 * @param {string}   args.model
 * @param {string}   args.prompt
 * @returns {Promise<string>}
 */
async function generate({ provider, model, prompt }) {
  if (provider === 'gemini') {
    const m = gemini().getGenerativeModel({ model });
    const result = await m.generateContent(prompt);
    return result.response.text();
  }
  throw new Error(`llm_adapter.generate: provider not implemented: ${provider}`);
}

module.exports = { chat, generate };
