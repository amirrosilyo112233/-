# SYSTEM STATUS MAP — `my-tutor`

> **Single source of truth for implementation progress.**
> Updated at: end of Phase 2 (anti_pseudo + routing live).
> A module is `WORKING` only if: code exists, imports resolve, runtime executes, and the flow has been exercised end-to-end.

**Status labels:** `NOT_STARTED` · `PLANNED` · `STUB` · `PARTIAL` · `WORKING` · `BLOCKED` · `NEEDS_REFACTOR` · `TESTED`

`TESTED` is reserved for modules with automated tests. None exist yet.

---

## 1 · Module Status Table

### Host shell (pre-existing application)

| Module | Status | Phase | Dependencies | Runtime Ready | Known Issues | Next Step |
|---|---|---|---|---|---|---|
| `backend/server.js` (Express) | `WORKING` | host | express, multer, cors | yes | none | — |
| `backend/whatsapp.js` (Green API integration) | `WORKING` | host | db, cognition/coordinator, event_log | yes — verified live | — | — |
| `backend/whatsapp.js` formatter + reactions | `WORKING` | host | — | yes | formats markdown→WhatsApp, sends 👀 ack reaction, quote-reply | — |
| `backend/tutor-style.js` (prompt) | `WORKING` | host | — | yes | added system-identity + "is-not" prohibitions + "translate language, not simplify" rule | — |
| `backend/db.js` (Postgres + JSON fallback) | `WORKING` | host | pg | yes | JSON fallback paths untested under load | — |
| `backend/tutor-style.js` (buildPrompt) | `WORKING` | host | none | yes | giant single prompt — to be decomposed by Routing+Teacher in Phase 2 | replace usage in Teacher when Phase 2 templates land |
| `backend/tutor-prompt.js` (legacy) | `NEEDS_REFACTOR` | host | none | unused | dead file | delete in cleanup pass |
| `frontend/src/**` (React UI) | `WORKING` | host | react, vite | yes | none relevant to cognition | — |
| `backend/voice.js` / `frontend/src/voice.js` | `WORKING` | host | Browser STT, Google Cloud TTS | yes | unrelated to cognition | — |
| Render deployment + GitHub Actions keepalive | `WORKING` | host | render.com, gh actions | yes | — | — |

### Cognition capsule (`backend/cognition/`)

| Module | Status | Phase | Dependencies | Runtime Ready | Known Issues | Next Step |
|---|---|---|---|---|---|---|
| `README.md` (capsule contract) | `WORKING` | 1 | — | n/a (doc) | — | — |
| `schemas.js` (JSDoc typedefs) | `WORKING` | 1 | — | n/a (doc) | exports `{}` intentionally | extend when agents land |
| `adapters/db_adapter.js` | `WORKING` | 1 | `../../db` | yes | exposes `insertEvent`, `getRecentEvents` only | extend for learner_state in Phase 2 |
| `adapters/llm_adapter.js` | `WORKING` | 2 | `@google/generative-ai`, `openai` | yes | exposes `chat`, `generate` (Gemini) + `chat`, `chatJson` (OpenAI w/ JSON mode) | — |
| `event_log.js` | `WORKING` | 1 | db_adapter | yes | write-only; no querying yet | `/api/events` exists as read path |
| `teacher.js` | `WORKING` | 2 | llm_adapter, ../tutor-style | yes | now accepts optional `{strategy, instruction}` and prepends a directive | — |
| `coordinator.js` | `WORKING` | 2 | anti_pseudo, routing, teacher, event_log | yes | full Phase 2 flow active: anti_pseudo → routing → teacher | — |
| `anti_pseudo.js` | `WORKING` | 2 | llm_adapter (OpenAI), prompts/anti_pseudo.txt | yes | GPT-4o-mini w/ JSON mode; deterministic short-circuits for empty assent; safe fallback on failure | exercise live & tune prompt from real data |
| `routing.js` | `WORKING` | 2 | (deterministic, no deps) | yes | 6 rules, all unit-tested; exposes STRATEGIES + INSTRUCTIONS | — |
| `prompts/anti_pseudo.txt` | `WORKING` | 2 | — | n/a (doc) | Hebrew prompt; 4 signals + 4 depth levels | iterate based on production telemetry |
| `learner_state.js` | `NOT_STARTED` | 3 | db_adapter | no | needs `learner_state` table | create table + module |
| `knowledge_map.js` | `STUB` (mental model only) | 3 | db_adapter | no | will return raw `book.content` initially | implement chunk retrieval |
| `ingestion.js` | `NOT_STARTED` | 3 | llm_adapter (Gemini Pro) | no | needs `knowledge_units` table | wire into `/api/books/upload` post-save |

### DB schema

| Table | Status | Phase | Notes |
|---|---|---|---|
| `profile`, `books`, `messages`, `chapters`, `chapter_qa`, `insights`, `scripts`, `field_log` | `WORKING` | host | pre-existing |
| `events` | `WORKING` | 1 | created in `initSchema()`; written by `event_log` |
| `learner_state` | `NOT_STARTED` | 2 | one row per book; `{ understandsWell, shaky, misconceptions, currentDepth }` |
| `knowledge_units` | `NOT_STARTED` | 3 | chunked book content + (later) embeddings |

### LLM providers

| Provider | Status | Phase | Used by | Notes |
|---|---|---|---|---|
| Gemini 2.5 Flash | `WORKING` | 1 | Teacher | live chat replies |
| Gemini 2.5 Pro | `WORKING` | host | Vision (upload), chapter summary, chapter QA, field log | unchanged |
| OpenAI GPT-4o-mini | `WORKING` | 2 | Anti-Pseudo | `OPENAI_API_KEY` set on Render; JSON mode used |
| OpenAI text-embedding-3-large | `NOT_STARTED` | 3 | Knowledge Map | only when embeddings retrieval lands |

---

## 2 · Current Runtime Flow Map (Phase 2, actual)

```
client (POST /api/books/:id/chat)
   │
   ▼
server.js  ─ db.getBook, getProfile, addMessage(user), getRecentMessages(20)
   │
   ▼
cognition/coordinator.handleChatMessage
   │   event: chat_received
   │
   ▼
cognition/anti_pseudo.evaluate
   │   • deterministic short-circuit for empty-assent / first-turn
   │   • else: llm_adapter.chatJson → OpenAI gpt-4o-mini (JSON mode)
   │   event: pseudo_evaluated { signal, depth, reason }
   │
   ▼
cognition/routing.decide  (pure, no LLM)
   │   • rule-based mapping: signal+depth → strategy + Hebrew directive
   │   event: routing_decided { strategy, ruleId }
   │
   ▼
cognition/teacher.respond
   │   • prepends strategic directive to systemInstruction
   │   event: teacher_invoked { model, strategy }
   │
   ▼
cognition/adapters/llm_adapter.chat  ───►  Gemini 2.5 Flash
   │                                        │
   │◄───────────────────────────────────────┘ reply text
   │   event: teacher_replied { replyLength, latencyMs, strategy }
   │
   ▼  return { reply }
coordinator
   │   event: chat_completed { latencyMs, strategy, signal }
   │
   ▼
server.js  ─ db.addMessage(assistant), db.updateBook, emoji hooks
   │
   ▼
HTTP 200  { message: reply }
```

**Two LLM calls per turn:** GPT-4o-mini (~500-1500ms classification) + Gemini Flash (~8-12s reply).
**Coordinator overhead:** still < 30ms.

All other endpoints (`/upload`, `/tts`, `/chapters/complete`, `/field-log`, `/insights`, `/scripts`, `/health`) bypass the cognition capsule entirely and continue to use Gemini directly.

---

## 3 · Existing Agent Map

| Agent | File | Status | Calls LLM? | Plug-in point |
|---|---|---|---|---|
| Runtime Coordinator | `cognition/coordinator.js` | `WORKING` (Phase 2 flow) | no | `server.js` chat route |
| Teacher | `cognition/teacher.js` | `WORKING` (strategy-aware) | yes — Gemini Flash | called by coordinator |
| Event Log | `cognition/event_log.js` | `WORKING` | no | called by all agents |
| Anti-Pseudo | `cognition/anti_pseudo.js` | `WORKING` | yes — GPT-4o-mini (JSON) | between chat_received and routing |
| Cognitive Routing | `cognition/routing.js` | `WORKING` | no | after Anti-Pseudo |
| Learner-State | — | `NOT_STARTED` (Phase 3) | no | read by routing; written by anti_pseudo |
| Knowledge Map | — | `NOT_STARTED` (Phase 3) | no (deterministic first; embeddings later) | queried by coordinator |
| Ingestion | — | `NOT_STARTED` (Phase 3) | will: Gemini Pro | after `/api/books/upload` |

---

## 4 · Existing Contract Map

| Contract | Defined in | Honored by |
|---|---|---|
| `ChatRequest`, `ChatResponse` | `cognition/schemas.js` | `coordinator.handleChatMessage` |
| `Event` | `cognition/schemas.js` | `event_log.log`, `db.addEvent` |
| `EventType` enum | `cognition/schemas.js` | currently emitted: `chat_received`, `teacher_invoked`, `teacher_replied`, `teacher_failed`, `chat_completed` |
| `StoredMessage`, `Book`, `Profile` | `cognition/schemas.js` | `server.js` → coordinator → teacher |
| `AntiPseudoResult` | `cognition/schemas.js` | `anti_pseudo.evaluate` ✅ |
| `RoutingDecision` (Strategy + instruction) | `cognition/schemas.js` + `routing.js` | `routing.decide` ✅, `teacher.respond` consumes ✅ |
| `LearnerState`, `KnowledgeMapResult` | `cognition/schemas.js` | **declared, not yet honored** (Phase 3) |

---

## 5 · Existing Event Flow Map

Each chat turn emits these events to the `events` table:

| Order | Event type | Emitted by | Carries |
|---|---|---|---|
| 1 | `chat_received` | coordinator | `messageLength`, `historyCount` |
| 2 | `pseudo_evaluated` | anti_pseudo | `signal`, `depth`, `reason`, `model`, `deterministic`, `fallback`, `error`, `latencyMs` |
| 3 | `routing_decided` | routing | `strategy`, `ruleId`, `signal`, `depth` |
| 4 | `teacher_invoked` | coordinator | `model`, `strategy` |
| 5a | `teacher_replied` | coordinator | `replyLength`, `model`, `historyLength`, `strategy`, `latencyMs` |
| 5b | `teacher_failed` (alt) | coordinator | `error`, `strategy`, `latencyMs` |
| 6 | `chat_completed` | coordinator | `strategy`, `signal`, total `latencyMs` |

**Read path (telemetry):** `GET /api/events?key=$DEBUG_KEY&limit=100` returns the most recent events as JSON.
Requires `DEBUG_KEY` env var on the server. Returns 503 if not configured, 401 if mismatch.

Direct SQL inspection:
```sql
SELECT created_at, type, agent, latency_ms, payload FROM events ORDER BY id DESC LIMIT 50;
```

---

## 6 · Current File Structure Map

```
my-tutor/
├── SYSTEM_STATUS.md                    ← THIS FILE
├── .github/workflows/keepalive.yml
├── backend/
│   ├── server.js                       (MODIFIED in Phase 1: chat route delegates to coordinator)
│   ├── db.js                           (MODIFIED in Phase 1: events table + addEvent/getRecentEvents)
│   ├── tutor-style.js                  (unchanged)
│   ├── tutor-prompt.js                 (legacy, unused — slated for removal)
│   ├── package.json
│   └── cognition/                      ← NEW capsule (Phase 1)
│       ├── README.md
│       ├── schemas.js
│       ├── coordinator.js              (WORKING — pass-through)
│       ├── teacher.js                  (WORKING — Gemini Flash)
│       ├── event_log.js                (WORKING — write-only)
│       ├── adapters/
│       │   ├── db_adapter.js           (WORKING — events only)
│       │   └── llm_adapter.js          (WORKING — Gemini + OpenAI)
│       ├── anti_pseudo.js              (WORKING — GPT-4o-mini)
│       ├── routing.js                  (WORKING — deterministic)
│       └── prompts/
│           └── anti_pseudo.txt         (Phase 2 prompt)
└── frontend/                           (unchanged in Phase 1)
    └── src/...
```

---

## 7 · Runtime Dependency Graph

```
server.js
  ├── db.js
  ├── tutor-style.js
  ├── @google/generative-ai           (still used directly for vision, chapter, field-log)
  └── cognition/coordinator.js
        ├── cognition/teacher.js
        │     ├── cognition/adapters/llm_adapter.js
        │     │     └── @google/generative-ai
        │     └── ../tutor-style.js
        └── cognition/event_log.js
              └── cognition/adapters/db_adapter.js
                    └── ../../db.js

Boundary invariants enforced by convention:
  - Nothing inside cognition/ except adapters/llm_adapter.js imports @google/generative-ai
  - Nothing inside cognition/ except adapters/db_adapter.js imports ../../db
  - Nothing inside cognition/ imports express/react/vite
```

---

## 8 · Integration Progress Tracker

### Phase 1 — Skeleton wiring  ✅ COMPLETE

- [x] `backend/cognition/` capsule created
- [x] `schemas.js` documents all contracts (active + future)
- [x] `event_log.js` write path operational
- [x] `events` table added to schema
- [x] `coordinator` wraps chat flow
- [x] `teacher` preserves existing Gemini Flash behavior
- [x] `server.js` chat route delegates to coordinator
- [x] No UI changes
- [x] No other endpoint changes
- [ ] Verified end-to-end against live Render — **PENDING USER TEST**
- [x] `/api/events` telemetry endpoint (auth-gated by `DEBUG_KEY`)

### Phase 2 — Cognition activation  ✅ COMPLETE

- [x] Add `OPENAI_API_KEY` env on Render
- [x] Extend `llm_adapter` with OpenAI provider (chat + chatJson with JSON mode)
- [x] Implement `anti_pseudo.js` (GPT-4o-mini, structured JSON, deterministic short-circuits, safe fallback)
- [x] Implement `routing.js` (rule-based decision tree, 6 rules)
- [x] Add prompt template for Anti-Pseudo at `cognition/prompts/anti_pseudo.txt`
- [x] Teacher accepts `{strategy, instruction}` and prepends a directive
- [x] Wire all three into `coordinator.handleChatMessage`
- [x] New events emitted: `pseudo_evaluated`, `routing_decided`
- [ ] **Verified live in production** — pending user test
- [ ] Per-strategy prompt templates (currently single directive string per strategy in routing.js — fine for MVP)
- [ ] `learner_state` table + module — deferred to Phase 3

### Phase 3 — Knowledge + Memory layer (NOT_STARTED)

- [ ] Add `learner_state` table + `learner_state.js` (tracks understandsWell/shaky/misconceptions across sessions)
- [ ] Add `knowledge_units` table
- [ ] Implement `ingestion.js` (Gemini Pro, runs once per upload)
- [ ] Implement `knowledge_map.js` (chunk retrieval; later: embeddings)
- [ ] Coordinator queries Knowledge Map before Anti-Pseudo

### Phase 4 — Observability (NOT_STARTED)

- [ ] `/api/events` debug endpoint (auth-gated)
- [ ] Lightweight events dashboard
- [ ] Per-request trace view

---

## 9 · Known Issues (Phase 1)

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | low | `tutor-prompt.js` is dead code | open — cleanup pass later |
| 2 | low | `getRecentMessages(20)` may produce empty Gemini history after trim of leading 'model' entries | open — Teacher will surface a clearer error in Phase 2 |
| 3 | low | Emoji-based insight/script post-processing still lives in `server.js` | open — to be moved to a dedicated Phase 2 agent or post-processing hook |
| 4 | info | Phase 1 has no automated tests | open — `TESTED` label cannot apply until tests exist |

---

## 10 · Maintenance Protocol

This file MUST be updated whenever any of the following happens:

1. A new module is added to `backend/cognition/`
2. A module's status changes (e.g. `STUB` → `WORKING`)
3. A new DB table is created
4. A new event type is emitted
5. A contract in `schemas.js` is added or modified
6. An LLM provider is added or swapped

**Rule:** If the code changed and this file did not, the change is incomplete.
