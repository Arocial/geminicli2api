# CLAUDE.md

## Project Overview

geminicli2api is a proxy server that wraps `@google/gemini-cli-core` to expose native Gemini API endpoints. It reuses the official CLI's OAuth authentication and CodeAssistServer for API communication.

## Tech Stack

- TypeScript (ES2022, ESM modules)
- Hono (HTTP framework) + @hono/node-server
- @google/gemini-cli-core (auth, API communication)

## Project Structure

```
src/
├── index.ts        # Entry point: init auth → start HTTP server
├── server.ts       # Hono app instance, error handling, route registration
├── routes.ts       # API route handlers (generateContent, streamGenerateContent, sessions)
├── credentials.ts  # OAuth init via gemini-cli-core, exposes auth primitives
├── session.ts      # Session manager: maps sessionId → CodeAssistServer instances
├── config.ts       # Model variant parsing (-search/-nothinking/-maxthinking), safety settings
└── middleware.ts   # GCA_PASSWORD Bearer token auth middleware
```

## Build & Run

```bash
npm install
npm run dev       # Development with tsx
npm run build     # Compile TypeScript
npm start         # Run compiled output
```

## Key Architecture Decisions

- Each session gets its own `CodeAssistServer` instance (the sessionId is baked into the constructor)
- `credentials.ts` exposes `getAuthClient()`, `getProjectId()`, `getUserTier()`, `getUserTierName()`, `getPaidTier()`, `buildHttpOptions()` so `session.ts` can create session-scoped servers
- Without `X-Session-Id` header, requests use a shared stateless server (backward compatible)
- All harm categories are set to `BLOCK_NONE` in config.ts
- Default thinking budget is 8192 tokens

## Common Patterns

- Route path parsing is manual (not Hono param patterns) due to the colon in `models/xxx:action`
- `as never` casts are used when passing params to CodeAssistServer methods due to type mismatches between our constructed params and the internal types
- Since v0.36.0, all needed exports (`setupUser`, `coreEvents`, `CoreEvent`, `LlmRole`) are available from the main `@google/gemini-cli-core` index
- `coreEvents.on(CoreEvent.ConsentRequest, ...)` is used to auto-confirm OAuth consent prompts
