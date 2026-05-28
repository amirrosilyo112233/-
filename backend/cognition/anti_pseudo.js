/**
 * Anti-Pseudo-Understanding Agent
 *
 * Classifies a user message into:
 *   signal: 'genuine' | 'partial' | 'parrot' | 'evasion'
 *   depth:  0 | 1 | 2 | 3
 *   reason: short Hebrew sentence
 *
 * Model: GPT-4o-mini (JSON mode for guaranteed parseable output).
 * Latency target: < 1.5s.
 * Failure mode: if OpenAI errors or returns invalid JSON, returns a safe-default
 *               classification (genuine/depth=2) so the chat never breaks.
 */

const fs = require('fs');
const path = require('path');
const llm = require('./adapters/llm_adapter');

const MODEL = 'gpt-4o-mini';
const PROVIDER = 'openai';

// Load prompt once at module init
const PROMPT_PATH = path.join(__dirname, 'prompts', 'anti_pseudo.txt');
const SYSTEM_PROMPT = fs.readFileSync(PROMPT_PATH, 'utf8');

/**
 * @param {Object} args
 * @param {string} args.userMessage          The just-sent user message
 * @param {string|null} args.lastTeacherMessage  The teacher's most recent reply (null if this is the first turn)
 * @param {string} [args.currentTopic]       Optional topic hint
 * @returns {Promise<{ signal: string, depth: number, reason: string, durationMs: number, fallback?: boolean, error?: string }>}
 */
async function evaluate({ userMessage, lastTeacherMessage, currentTopic }) {
  const t0 = Date.now();

  // ── Hard rules: don't call the LLM if we can decide deterministically ──────
  // First turn — nothing to classify
  if (!lastTeacherMessage) {
    return {
      signal: 'genuine', depth: 2, reason: 'first message — no prior teacher turn to evaluate against',
      durationMs: Date.now() - t0, deterministic: true
    };
  }

  // Empty assent: short message that is just agreement → evasion
  const trimmed = (userMessage || '').trim();
  const EMPTY_ASSENT = /^(הבנתי|כן|אוקיי|אוקי|ברור|מעניין|טוב|נהדר|מצוין|תודה|ok|okay|got it|i see|yes)\.?$/i;
  if (trimmed.length < 10 && EMPTY_ASSENT.test(trimmed)) {
    return {
      signal: 'evasion', depth: 0, reason: 'תגובה ריקה ללא הוכחת הבנה',
      durationMs: Date.now() - t0, deterministic: true
    };
  }

  // ── Otherwise: ask GPT-4o-mini to classify ───────────────────────────────
  const userPayload = JSON.stringify({
    lastTeacherMessage: lastTeacherMessage.substring(0, 1500), // cap for token budget
    userMessage: trimmed,
    currentTopic: currentTopic || null
  });

  try {
    const parsed = await llm.chatJson({
      model: MODEL,
      systemInstruction: SYSTEM_PROMPT,
      userMessage: userPayload,
      temperature: 0.2,
      maxTokens: 200
    });

    // Validate shape
    const validSignals = ['genuine', 'partial', 'parrot', 'evasion'];
    const signal = validSignals.includes(parsed.signal) ? parsed.signal : 'partial';
    const depth = Number.isInteger(parsed.depth) && parsed.depth >= 0 && parsed.depth <= 3 ? parsed.depth : 1;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.substring(0, 200) : '';

    return { signal, depth, reason, durationMs: Date.now() - t0 };
  } catch (e) {
    // Safe default: don't block the chat on an LLM failure
    return {
      signal: 'partial', depth: 1, reason: 'anti_pseudo failed — falling back to partial',
      durationMs: Date.now() - t0, fallback: true, error: e.message
    };
  }
}

module.exports = { evaluate, MODEL, PROVIDER };
