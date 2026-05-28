/**
 * DB Adapter — the ONLY file inside cognition/ allowed to require ../../db.
 * Keeps the cognition capsule decoupled from storage internals.
 *
 * Phase 1 surface: events only. Future: learner_state, knowledge_units.
 */

const db = require('../../db');

async function insertEvent({ type, bookId, agent, payload, latencyMs }) {
  return db.addEvent({ type, bookId, agent, payload, latencyMs });
}

async function getRecentEvents(limit = 100) {
  return db.getRecentEvents(limit);
}

// ── RAG ───────────────────────────────────────────────────────────────────────
async function addChunks(bookId, chunks) { return db.addChunks(bookId, chunks); }
async function getChunks(bookId) { return db.getChunks(bookId); }
async function deleteChunks(bookId) { return db.deleteChunks(bookId); }

// ── Learner State ─────────────────────────────────────────────────────────────
async function getLearnerState(bookId) { return db.getLearnerState(bookId); }
async function upsertLearnerState(bookId, data) { return db.upsertLearnerState(bookId, data); }

module.exports = { insertEvent, getRecentEvents, addChunks, getChunks, deleteChunks, getLearnerState, upsertLearnerState };
