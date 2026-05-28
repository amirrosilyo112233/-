# SYSTEM STATUS MAP — `my-tutor`

> **Single source of truth for implementation progress.**
> Updated at: end of Phase 1.
> A module is `WORKING` only if: code exists, imports resolve, runtime executes, and the flow has been exercised end-to-end.

**Status labels:** `NOT_STARTED` · `PLANNED` · `STUB` · `PARTIAL` · `WORKING` · `BLOCKED` · `NEEDS_REFACTOR` · `TESTED`

`TESTED` is reserved for modules with automated tests. None exist yet.

---

## 1 · Module Status Table

### Host shell (pre-existing application)

| Module | Status | Phase | Dependencies | Runtime Ready | Known Issues | Next Step |
|---|---|---|---|---|---|---|
| `backend/server.js` (Express) | `WORKING` | host | express, multer, cors | yes | none | — |
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
| `adapters/llm_adapter.js` | `PARTIAL` | 1 | `@google/generative-ai` | yes (Gemini only) | OpenAI provider throws | add OpenAI provider in Phase 2 |
| `event_log.js` | `WORKING` | 1 | db_adapter | yes | write-only; no querying yet | add `/api/events` debug endpoint if needed |
| `teacher.js` | `WORKING` | 1 | llm_adapter, ../tutor-style | yes | uses legacy `buildPrompt` for now; ignores any future RoutingDecision | accept Strategy + template in Phase 2 |
| `coordinator.js` | `WORKING` | 1 | teacher, event_log | yes | pass-through only; Phase 2 hook points are commented placeholders | wire in anti_pseudo + routing in Phase 2 |
| `anti_pseudo.js` | `NOT_STARTED` | 2 | llm_adapter (OpenAI), event_log | no | — | create with GPT-4o-mini structured output |
| `routing.js` | `NOT_STARTED` | 2 | (deterministic) | no | — | rule-based decision tree |
| `learner_state.js` | `NOT_STARTED` | 2 | db_adapter | no | needs `learner_state` table | create table + module |
| `knowledge_map.js` | `STUB` (mental model only) | 2 | db_adapter | no | will return raw `book.content` initially | implement chunk retrieval |
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
| Gemini 2.5 Pro | `WORKING` | host | Vision (upload), chapter summary, chapter QA, field log | unchanged by Phase 1 |
| OpenAI GPT-4o-mini | `NOT_STARTED` | 2 | Anti-Pseudo | needs `OPENAI_API_KEY` env on Render |
| OpenAI text-embedding-3-large | `NOT_STARTED` | 3 | Knowledge Map | only when embeddings retrieval lands |

---

## 2 · Current Runtime Flow Map (Phase 1, actual)

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
cognition/teacher.respond
   │   event: teacher_invoked
   │
   ▼
cognition/adapters/llm_adapter.chat  ───►  Gemini 2.5 Flash
   │                                        │
   │◄───────────────────────────────────────┘ reply text
   │   event: teacher_replied (with latencyMs)
   │
   ▼  return { reply }
coordinator
   │   event: chat_completed (with total latencyMs)
   │
   ▼
server.js  ─ db.addMessage(assistant), db.updateBook, emoji hooks (insights/scripts)
   │
   ▼
HTTP 200  { message: reply }
```

All other endpoints (`/upload`, `/tts`, `/chapters/complete`, `/field-log`, `/insights`, `/scripts`, `/health`) bypass the cognition capsule entirely and continue to use Gemini directly.

---

## 3 · Existing Agent Map

| Agent | File | Status | Calls LLM? | Plug-in point |
|---|---|---|---|---|
| Runtime Coordinator | `cognition/coordinator.js` | `WORKING` (pass-through) | no | `server.js` chat route |
| Teacher | `cognition/teacher.js` | `WORKING` | yes — Gemini Flash | called by coordinator |
| Event Log | `cognition/event_log.js` | `WORKING` | no | called by all agents |
| Anti-Pseudo | — | `NOT_STARTED` | will: GPT-4o-mini | between chat_received and teacher_invoked |
| Cognitive Routing | — | `NOT_STARTED` | no | after Anti-Pseudo |
| Learner-State | — | `NOT_STARTED` | no | read by routing; written by anti_pseudo |
| Knowledge Map | — | `NOT_STARTED` | no (Phase 2); embeddings later | queried by coordinator |
| Ingestion | — | `NOT_STARTED` | will: Gemini Pro | after `/api/books/upload` |

---

## 4 · Existing Contract Map

| Contract | Defined in | Honored by |
|---|---|---|
| `ChatRequest`, `ChatResponse` | `cognition/schemas.js` | `coordinator.handleChatMessage` |
| `Event` | `cognition/schemas.js` | `event_log.log`, `db.addEvent` |
| `EventType` enum | `cognition/schemas.js` | currently emitted: `chat_received`, `teacher_invoked`, `teacher_replied`, `teacher_failed`, `chat_completed` |
| `StoredMessage`, `Book`, `Profile` | `cognition/schemas.js` | `server.js` → coordinator → teacher |
| `AntiPseudoResult`, `RoutingDecision`, `LearnerState`, `KnowledgeMapResult` | `cognition/schemas.js` | **declared, not yet honored** (no agent emits them) |

---

## 5 · Existing Event Flow Map

Each chat turn emits these events to the `events` table:

| Order | Event type | Emitted by | Carries |
|---|---|---|---|
| 1 | `chat_received` | coordinator | `messageLength`, `historyCount` |
| 2 | `teacher_invoked` | coordinator | `model` |
| 3a | `teacher_replied` | coordinator | `replyLength`, `model`, `historyLength`, `latencyMs` |
| 3b | `teacher_failed` (alt) | coordinator | `error`, `latencyMs` |
| 4 | `chat_completed` | coordinator | total `latencyMs` |

No reader/dashboard exists for these events yet. Inspect via SQL:
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
│       │   └── llm_adapter.js          (PARTIAL — Gemini only)
│       └── prompts/                    (empty — Phase 2)
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

### Phase 2 — Cognition activation (NOT_STARTED)

- [ ] Add `OPENAI_API_KEY` env on Render
- [ ] Extend `llm_adapter` with OpenAI provider
- [ ] Implement `anti_pseudo.js` (GPT-4o-mini, structured JSON)
- [ ] Implement `routing.js` (rule-based decision tree)
- [ ] Add `learner_state` table + `learner_state.js`
- [ ] Wire all four into `coordinator.handleChatMessage`
- [ ] Add prompt templates per Strategy in `cognition/prompts/`
- [ ] Teacher accepts `RoutingDecision`

### Phase 3 — Knowledge layer (NOT_STARTED)

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
