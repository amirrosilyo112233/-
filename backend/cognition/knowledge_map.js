/**
 * Knowledge Map Agent — RAG (Retrieval-Augmented Generation)
 *
 * Responsibilities:
 *   1. ingest(bookId, content)  — chunk text → embed → store in DB
 *   2. query(bookId, question)  — embed question → cosine similarity → top-K chunks
 *
 * No LLM for retrieval (pure vector math). Gemini embeddings for indexing.
 *
 * Phase 3 — this agent replaces the "full book in prompt" approach.
 * When indexed: teacher receives only the 5 most relevant chunks (~1500 chars)
 *              instead of 200,000 chars of raw text.
 */

const llm = require('./adapters/llm_adapter');
const dbAdapter = require('./adapters/db_adapter');

const CHUNK_SIZE_WORDS = 400;   // target words per chunk
const CHUNK_OVERLAP = 40;       // words of overlap between consecutive chunks
const TOP_K = 5;                // chunks to return per query
const MIN_CHUNK_WORDS = 30;     // ignore chunks smaller than this

// ── Text chunking ─────────────────────────────────────────────────────────────

/**
 * Split text into overlapping word-based chunks.
 * Tries to break at paragraph/sentence boundaries.
 * @param {string} text
 * @returns {string[]}
 */
function chunkText(text) {
  if (!text) return [];

  // Split into paragraphs first
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let currentWords = [];

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/);

    // If adding this paragraph would exceed chunk size, flush first
    if (currentWords.length + paraWords.length > CHUNK_SIZE_WORDS && currentWords.length >= MIN_CHUNK_WORDS) {
      chunks.push(currentWords.join(' '));
      // Overlap: keep last CHUNK_OVERLAP words as context bridge
      currentWords = currentWords.slice(-CHUNK_OVERLAP);
    }

    currentWords.push(...paraWords);

    // Flush if current is already too big
    while (currentWords.length > CHUNK_SIZE_WORDS) {
      chunks.push(currentWords.slice(0, CHUNK_SIZE_WORDS).join(' '));
      currentWords = currentWords.slice(CHUNK_SIZE_WORDS - CHUNK_OVERLAP);
    }
  }

  // Final chunk
  if (currentWords.length >= MIN_CHUNK_WORDS) {
    chunks.push(currentWords.join(' '));
  }

  return chunks;
}

// ── Vector math ───────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Index a book's content into knowledge chunks.
 * Runs in background — caller does not await.
 *
 * @param {number|string} bookId
 * @param {string} content   full extracted book text
 */
async function ingest(bookId, content) {
  const t0 = Date.now();
  console.log(`[knowledge_map] ingesting book ${bookId}...`);
  try {
    // Clear any previous chunks for this book
    await dbAdapter.deleteChunks(bookId);

    const texts = chunkText(content);
    console.log(`[knowledge_map] ${texts.length} chunks to embed`);

    const chunkData = [];
    for (let i = 0; i < texts.length; i++) {
      const embedding = await llm.embedText(texts[i]);
      chunkData.push({ chunkIndex: i, content: texts[i], embedding });

      // Batch write every 50 chunks
      if (chunkData.length === 50 || i === texts.length - 1) {
        await dbAdapter.addChunks(bookId, chunkData);
        chunkData.length = 0;
        console.log(`[knowledge_map] embedded ${i + 1}/${texts.length} chunks`);
      }
    }

    console.log(`[knowledge_map] book ${bookId} indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`[knowledge_map] ingestion failed for book ${bookId}:`, e.message);
  }
}

/**
 * Retrieve the most relevant chunks for a query.
 *
 * @param {number|string} bookId
 * @param {string} question   the user's message or topic
 * @param {number} [topK]
 * @returns {Promise<{ chunks: string[], found: boolean }>}
 *   chunks — array of text strings (most relevant first)
 *   found  — false if no chunks indexed (fallback to full content)
 */
async function query(bookId, question, topK = TOP_K) {
  const allChunks = await dbAdapter.getChunks(bookId);

  if (!allChunks || allChunks.length === 0) {
    return { chunks: [], found: false };
  }

  // Embed the question
  const qVec = await llm.embedText(question);

  // Score all chunks
  const scored = allChunks
    .filter(c => c.embedding)
    .map(c => ({
      content: c.content,
      score: cosineSimilarity(qVec, c.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    chunks: scored.map(c => c.content),
    found: scored.length > 0
  };
}

module.exports = { ingest, query, chunkText };
