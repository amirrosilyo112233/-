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
 * Normalize a history entry into OpenAI shape `{ role, content }`.
 * Handles three input shapes:
 *   1. OpenAI-native:  { role: 'user'|'assistant'|'system', content: 'text' }
 *   2. Gemini-shaped:  { role: 'user'|'model',              parts: [{ text: 'text' }] }
 *   3. Mixed / partial — best-effort
 */
function toOpenAiMessage(h) {
  if (!h) return null;
  const role = h.role === 'model' ? 'assistant' : (h.role || 'user');
  let content = h.content;
  if (typeof content !== 'string') {
    // Try Gemini-shape parts
    if (Array.isArray(h.parts) && h.parts.length > 0 && typeof h.parts[0].text === 'string') {
      content = h.parts.map(p => p.text || '').join('');
    } else {
      content = '';
    }
  }
  return { role, content };
}

/**
 * Multi-turn chat call.
 * @param {Object} args
 * @param {'gemini'|'openai'} args.provider
 * @param {string} args.model
 * @param {string} [args.systemInstruction]
 * @param {Array}  [args.history]   Provider-agnostic for OpenAI; Gemini-shape for Gemini.
 *                                   The adapter normalizes for OpenAI.
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
    // Uses Responses API (newer endpoint than Chat Completions).
    // `instructions` = system prompt; `input` = ordered messages array.
    const input = [];
    for (const h of history) {
      const normalized = toOpenAiMessage(h);
      if (normalized && normalized.content) input.push(normalized);
    }
    input.push({ role: 'user', content: message });

    const resp = await openai().responses.create({
      model,
      instructions: systemInstruction || undefined,
      input
    });
    // SDK exposes a top-level convenience accessor for the full text output
    return resp.output_text || '';
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
 * Structured JSON completion. Supports OpenAI (response_format) and
 * Gemini (responseMimeType=application/json) — both guarantee parseable JSON.
 * Returns a parsed object.
 *
 * @param {Object} args
 * @param {'openai'|'gemini'} [args.provider]   default 'openai' for back-compat
 * @param {string} args.model            e.g. 'gpt-4o-mini' | 'gemini-3.5-flash'
 * @param {string} args.systemInstruction
 * @param {string} args.userMessage
 * @param {number} [args.temperature]    default 0.2
 * @param {number} [args.maxTokens]      default 200
 * @returns {Promise<Object>}
 */
async function chatJson({ provider = 'openai', model, systemInstruction, userMessage, temperature = 0.2, maxTokens = 200 }) {
  if (provider === 'openai') {
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
    try { return JSON.parse(raw); }
    catch (e) {
      throw new Error(`chatJson(openai): non-JSON despite response_format. raw="${raw.substring(0, 200)}"`);
    }
  }
  if (provider === 'gemini') {
    const m = gemini().getGenerativeModel({
      model,
      systemInstruction,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json'
      }
    });
    const result = await m.generateContent(userMessage);
    const raw = result.response.text();
    try { return JSON.parse(raw); }
    catch (e) {
      throw new Error(`chatJson(gemini): non-JSON despite responseMimeType. raw="${raw.substring(0, 200)}"`);
    }
  }
  throw new Error(`chatJson: provider not implemented: ${provider}`);
}

/**
 * Generate an embedding vector for a text string.
 * Uses Gemini text-embedding-004 (768 dimensions).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const model = gemini().getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

module.exports = { chat, generate, chatJson, embedText };
