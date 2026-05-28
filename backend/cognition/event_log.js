/**
 * Event Log Agent — write-only sink for runtime visibility.
 *
 * Guarantees:
 *  - fire-and-forget: never throws into the calling agent's flow
 *  - failure to log is logged to console.warn but does not propagate
 *  - all writes go through db_adapter (no direct DB import)
 *
 * Phase 1: writes only. Querying/visualization is out of MVP scope.
 */

const dbAdapter = require('./adapters/db_adapter');

/**
 * Record a runtime event.
 * @param {import('./schemas').Event} event
 */
async function log(event) {
  try {
    await dbAdapter.insertEvent({
      type: event.type,
      bookId: event.bookId ?? null,
      agent: event.agent ?? null,
      payload: event.payload ?? {},
      latencyMs: event.latencyMs ?? null
    });
  } catch (e) {
    console.warn(`[event_log] failed to write event "${event.type}":`, e.message);
  }
}

module.exports = { log };
