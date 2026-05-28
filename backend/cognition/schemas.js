/**
 * @file Cognition runtime — input/output schemas.
 *
 * Single source of truth for all contracts between agents.
 * No runtime code here. JSDoc typedefs only. Pure documentation.
 *
 * Status: Phase 1 — only ChatRequest, ChatResponse, Event are used.
 *         The rest are declared early so future agents have a contract to build against.
 */

// ─── Core message shapes ─────────────────────────────────────────────────────

/**
 * @typedef {Object} StoredMessage
 * @property {'user'|'assistant'} role
 * @property {string} content
 * @property {string} [created_at]  ISO timestamp
 */

/**
 * @typedef {Object} Book
 * @property {number} id
 * @property {string} title
 * @property {string} language
 * @property {string} [content]               Full book text (may be large)
 * @property {string|null} [current_chapter]
 * @property {string[]|string} [completed_topics]
 */

/**
 * @typedef {Object} Profile
 * @property {string} [name]
 * @property {string} [profession]
 * @property {any[]}  [children]
 * @property {any[]}  [challenges]
 */

// ─── Coordinator I/O (Phase 1 — active) ──────────────────────────────────────

/**
 * @typedef {Object} ChatRequest
 * @property {number|string} bookId
 * @property {string}        userMessage
 * @property {Profile}       profile
 * @property {Book}          book
 * @property {StoredMessage[]} recentMessages  Last N messages including the just-saved user message.
 */

/**
 * @typedef {Object} ChatResponse
 * @property {string} reply
 */

// ─── Event log (Phase 1 — active) ────────────────────────────────────────────

/**
 * @typedef {(
 *   'chat_received'      |
 *   'teacher_invoked'    |
 *   'teacher_replied'    |
 *   'teacher_failed'     |
 *   'chat_completed'     |
 *   'pseudo_evaluated'   |   // phase 2
 *   'routing_decided'    |   // phase 2
 *   'state_updated'      |   // phase 2
 *   'ingestion_done'         // phase 2
 * )} EventType
 */

/**
 * @typedef {Object} Event
 * @property {EventType} type
 * @property {number|string|null} [bookId]
 * @property {string}    [agent]      'coordinator' | 'teacher' | 'anti_pseudo' | ...
 * @property {Object}    [payload]
 * @property {number}    [latencyMs]
 */

// ─── Future agent contracts (Phase 2 — declared, NOT implemented) ────────────

/**
 * @typedef {Object} AntiPseudoResult
 * @property {0|1|2|3} depth
 * @property {'parrot'|'partial'|'genuine'|'evasion'} signal
 * @property {string}  reason
 */

/**
 * @typedef {'EXPLAIN_DEEPER'|'CHALLENGE'|'MOVE_FORWARD'|'BACKTRACK'|'EXAMPLE'|'WAIT_FOR_USER'} Strategy
 */

/**
 * @typedef {Object} RoutingDecision
 * @property {Strategy} strategy
 * @property {string}   instruction
 */

/**
 * @typedef {Object} LearnerState
 * @property {string[]} understandsWell
 * @property {string[]} shaky
 * @property {string[]} misconceptions
 * @property {0|1|2|3}  currentDepth
 */

/**
 * @typedef {Object} KnowledgeUnit
 * @property {number} id
 * @property {string} topic
 * @property {string} content
 * @property {number} [orderIdx]
 */

/**
 * @typedef {Object} KnowledgeMapResult
 * @property {KnowledgeUnit[]} relevantUnits
 * @property {string|null}     currentTopicId
 */

module.exports = {}; // schemas are JSDoc-only; nothing exported at runtime
