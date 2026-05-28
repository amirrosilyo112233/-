/**
 * LLM Adapter — unified interface across providers.
 * The ONLY file inside cognition/ allowed to require an LLM SDK.
 *
 * Phase 2: Gemini (chat + generate) + OpenAI (chat with JSON output).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { OpenAI } = require('openai');

// ── Lazy clients ──────────────────────────────────────────────────────────────
let _gemini = null;
function gemini() {
  if (!_gemini) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _gemini;
}

let _openai = null;
function openai() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Multi-turn chat call.
 * @param {Object} args
 * @param {'gemini'|'openai'} args.provider
 * @param {string} args.model
 * @param {string} [args.systemInstruction]
 * @param {Array}  [args.history]   Provider-shaped history (caller's responsibility)
 * @param {string} args.message
 * @returns {Promise<string>}
 */
async function chat({ provider, model, systemInstruction, history = [], message }) {
  if (provider === 'gemini') {
    const m = gemini().getGenerativeModel({ model, systemInstruction });
    const session = m.startChat({ history });
    const result = await session.sendMessage(message);
    return result.response.text();
  }
  if (provider === 'openai') {
    // history here is expected as [{ role: 'user'|'assistant'|'system', content: '...' }, ...]
    const messages = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    for (const h of history) messages.push({ role: h.role, content: h.content });
    messages.push({ role: 'user', content: message });
    const resp = await openai().chat.completions.create({ model, messages });
    return resp.choices[0].message.content;
  }
  throw new Error(`llm_adapter.chat: provider not implemented: ${provider}`);
}

/**
 * Single-shot completion. (Gemini: generateContent. OpenAI: not exposed here — use chatJson.)
 */
async function generate({ provider, model, prompt }) {
  if (provider === 'gemini') {
    const m = gemini().getGenerativeModel({ model });
    const result = await m.generateContent(prompt);
    return result.response.text();
  }
  throw new Error(`llm_adapter.generate: provider not implemented: ${provider}`);
}

/**
 * Structured JSON completion. OpenAI only — uses response_format=json_object to
 * guarantee parseable JSON. Returns a parsed object.
 * @param {Object} args
 * @param {string} args.model           e.g. 'gpt-4o-mini'
 * @param {string} args.systemInstruction
 * @param {string} args.userMessage
 * @param {number} [args.temperature]   default 0.2 (low — we want classification, not creativity)
 * @param {number} [args.maxTokens]     default 200
 * @returns {Promise<Object>}
 */
async function chatJson({ model, systemInstruction, userMessage, temperature = 0.2, maxTokens = 200 }) {
  const resp = await openai().chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userMessage }
    ]
  });
  const raw = resp.choices[0].message.content;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`chatJson: model returned non-JSON despite response_format. raw="${raw.substring(0, 200)}"`);
  }
}

module.exports = { chat, generate, chatJson };
