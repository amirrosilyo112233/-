# `backend/cognition/` — Isolated Cognitive Runtime Module

This folder is a **capsule**. It contains the cognitive runtime layer that wraps the LLM.
The host application (Express, React, Postgres) does not know what is inside.
The capsule does not know what is outside, except through narrow adapters.

## Contract with the host

| Direction | What may cross the boundary |
|---|---|
| Host → Capsule | `coordinator.handleChatMessage({ bookId, userMessage, profile, book, recentMessages })` |
| Capsule → Host | A single `{ reply: string }` per chat request |
| Capsule → DB | Only via `adapters/db_adapter.js` (no `require('../db')` elsewhere) |
| Capsule → LLM | Only via `adapters/llm_adapter.js` (no SDK imports elsewhere) |

## Forbidden inside the capsule

- `require('express')`, `require('react')`, anything UI
- Direct `require('../db')` outside `adapters/`
- Direct `require('@google/generative-ai')` outside `adapters/`
- Cross-agent calls (agents only talk through the coordinator)
- Side effects outside event_log and explicit adapter calls

## Phase 1 scope

Only two real modules: **coordinator** + **teacher**.
All other agents listed in `SYSTEM_STATUS.md` are `NOT_STARTED` or `STUB`.

## File map

```
cognition/
├── README.md             ← this file
├── schemas.js            ← JSDoc typedefs (single source of contract truth)
├── event_log.js          ← write-only event sink
├── coordinator.js        ← orchestration (phase 1: pass-through to teacher)
├── teacher.js            ← real Gemini call (phase 1: identical behavior to previous inline code)
├── adapters/
│   ├── db_adapter.js     ← thin wrapper around ../db.js
│   └── llm_adapter.js    ← unified LLM interface (phase 1: Gemini only)
└── prompts/              ← (empty in phase 1; teacher uses tutor-style.buildPrompt)
```

## Replacing the capsule

If `backend/cognition/` is deleted, the only code path that breaks is the chat route.
Restore it by reverting the single change in `server.js` chat handler.
The rest of the host (uploads, archive, field log, TTS, vision) is untouched.
