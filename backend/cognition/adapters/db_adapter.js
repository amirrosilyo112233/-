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

module.exports = { insertEvent, getRecentEvents };
