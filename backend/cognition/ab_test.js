/**
 * A/B Test Module — compares Gemini vs OpenAI on the same question.
 *
 * Read-only against the cognition state:
 *   - Pulls the same context the live coordinator would build
 *     (book, profile, recent messages, learner state, RAG chunks, field log)
 *   - Builds the same teacher prompt via buildPrompt()
 *   - Calls llm.chat() in parallel with two (provider, model) pairs
 *
 * Does NOT:
 *   - Save messages to DB (not part of the learning history)
 *   - Update learner_state
 *   - Update book.updated_at
 *   - Run anti_pseudo / routing
 *
 * The fairness guarantee: identical system instruction + identical history +
 * identical user message → only the (provider, model) differs.
 *
 * Future-proof: accepts `type: 'question' | 'lesson'`. Currently only 'question'
 * is implemented. 'lesson' is reserved for `/השווה שיעור` later.
 */

const db = require('../db');
const { buildPrompt } = require('../tutor-style');
const llm = require('./adapters/llm_adapter');
const knowledgeMap = require('./knowledge_map');
const learnerState = require('./learner_state');
const eventLog = require('./event_log');
const config = require('./config');

const SUPPORTED_TYPES = new Set(['question']);
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * @typedef {Object} ProviderResult
 * @property {string} provider
 * @property {string} model
 * @property {string} text
 * @property {number} ms
 * @property {boolean} ok
 * @property {string} [error]
 */

/**
 * @param {Object} args
 * @param {string|number} args.bookId
 * @param {'fast'|'pro'} args.mode
 * @param {'question'|'lesson'} [args.type='question']
 * @param {string} args.payload     for type=question, this is the user's question text
 * @param {string} [args.userPhone] for telemetry + vote linking
 * @returns {Promise<{
 *   ok: boolean,
 *   type: string,
 *   mode: string,
 *   baseline: ProviderResult,
 *   challenger: ProviderResult,
 *   comparisonId: number|null,
 *   error?: string
 * }>}
 */
async function compareProviders({ bookId, mode, type = 'question', payload, userPhone }) {
  if (!SUPPORTED_TYPES.has(type)) {
    return {
      ok: false,
      type,
      mode,
      baseline: null,
      challenger: null,
      comparisonId: null,
      error: `type "${type}" not yet implemented — מצב זה יוטמע בעתיד`
    };
  }

  const modeCfg = config.abTest[mode];
  if (!modeCfg) {
    return {
      ok: false,
      type,
      mode,
      baseline: null,
      challenger: null,
      comparisonId: null,
      error: `unknown mode: ${mode}`
    };
  }

  // ── 1. Pull shared context (read-only) ─────────────────────────────────────
  const book = await db.getBook(bookId);
  if (!book) {
    return { ok: false, type, mode, baseline: null, challenger: null, comparisonId: null, error: 'book not found' };
  }
  const profile = await db.getProfile();
  const recentMessages = await db.getRecentMessages(bookId, 20);

  let stateSnapshot = null;
  try { stateSnapshot = await learnerState.get(bookId); }
  catch (_) { /* learner_state may not exist for new books */ }

  // RAG retrieval (same as coordinator does for live chat)
  let relevantChunks = [];
  if (book?.indexed_at) {
    try {
      const ragResult = await knowledgeMap.query(bookId, payload);
      if (ragResult.found) relevantChunks = ragResult.chunks;
    } catch (e) {
      console.warn('[ab_test] RAG query failed:', e.message);
    }
  }

  // Session restart heuristic (same as coordinator)
  let sessionContext = null;
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    if (recentMessages[i].role === 'assistant' && recentMessages[i].created_at) {
      const gap = Date.now() - new Date(recentMessages[i].created_at).getTime();
      if (gap > FOUR_HOURS_MS) {
        const hours = Math.round(gap / (60 * 60 * 1000));
        sessionContext = {
          isRestart: true,
          hoursSinceLast: hours,
          gapLabel: hours < 24 ? `לפני ${hours} שעות` : (hours < 48 ? 'אתמול' : `לפני ${Math.round(hours / 24)} ימים`),
          lastTeacherSnippet: (recentMessages[i].content || '').substring(0, 400)
        };
      }
      break;
    }
  }

  let recentFieldEntries = [];
  try {
    const logs = await db.getRecentFieldLog(5);
    recentFieldEntries = (logs || []).filter(l => !l.book_id || l.book_id === parseInt(bookId)).slice(0, 3);
  } catch (_) { /* optional */ }

  // ── 2. Build the shared prompt (identical for both providers) ──────────────
  const systemInstruction = buildPrompt(profile, book, relevantChunks, stateSnapshot, {
    sessionContext, recentFieldEntries
  });

  // History in Gemini shape — chat() will normalize it for OpenAI internally
  const history = recentMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  // Gemini requires the first history entry to be role 'user'
  while (history.length > 0 && history[0].role === 'model') history.shift();

  // ── 3. Run both providers in parallel ──────────────────────────────────────
  const runOne = async (side) => {
    const t0 = Date.now();
    try {
      const text = await Promise.race([
        llm.chat({
          provider: side.provider,
          model: side.model,
          systemInstruction,
          history,
          message: payload
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timeout after ${config.abTest.timeoutMs}ms`)), config.abTest.timeoutMs)
        )
      ]);
      return { provider: side.provider, model: side.model, text, ms: Date.now() - t0, ok: true };
    } catch (e) {
      return { provider: side.provider, model: side.model, text: '', ms: Date.now() - t0, ok: false, error: e.message };
    }
  };

  const [baseline, challenger] = await Promise.all([
    runOne(modeCfg.baseline),
    runOne(modeCfg.challenger)
  ]);

  // ── 4. Persist comparison + emit event ─────────────────────────────────────
  let comparisonId = null;
  try {
    const row = await db.addAbComparison({
      userPhone,
      bookId,
      mode,
      type,
      userInput: payload,
      baseline,
      challenger
    });
    comparisonId = row?.id || null;
  } catch (e) {
    console.warn('[ab_test] failed to persist comparison:', e.message);
  }

  eventLog.log({
    type: 'ab_compared',
    bookId,
    agent: 'ab_test',
    payload: {
      mode,
      kind: type,
      baselineModel: baseline.model,
      challengerModel: challenger.model,
      baselineMs: baseline.ms,
      challengerMs: challenger.ms,
      baselineOk: baseline.ok,
      challengerOk: challenger.ok,
      comparisonId
    }
  });

  return {
    ok: baseline.ok || challenger.ok,
    type, mode,
    baseline, challenger,
    comparisonId
  };
}

/**
 * Record a 1/2/3 preference vote for the most recent comparison from this user
 * that's still inside the vote window.
 *
 * @param {string} userPhone
 * @param {number} vote                1 = baseline (Gemini), 2 = challenger (OpenAI), 3 = tie
 * @returns {Promise<{recorded: boolean, comparisonId?: number, reason?: string}>}
 */
async function recordVote(userPhone, vote) {
  if (![1, 2, 3].includes(vote)) {
    return { recorded: false, reason: 'invalid vote (must be 1, 2, or 3)' };
  }
  const pending = await db.getLatestPendingAb(userPhone, config.abTest.voteWindowMs);
  if (!pending) {
    return { recorded: false, reason: 'no pending comparison within window' };
  }
  await db.recordAbVote(pending.id, vote);
  eventLog.log({
    type: 'ab_voted',
    agent: 'ab_test',
    payload: { comparisonId: pending.id, vote, mode: pending.mode, type: pending.type }
  });
  return { recorded: true, comparisonId: pending.id };
}

module.exports = { compareProviders, recordVote };
