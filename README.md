# gcli2api

Gemini CLI to API Proxy — a proxy server built on `@google/gemini-cli-core` that reuses the official CLI's OAuth authentication and `CodeAssistServer` to expose native Gemini API endpoints.

## Quick Start

```bash
npm install
npm run dev
```

On first launch, a Google OAuth login flow will be triggered. Once authenticated, the server listens on `http://localhost:3000`.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Listen port | `3000` |
| `PROXY_PASSWORD` | API access password (no auth if unset) | - |
| `HTTPS_PROXY` / `HTTP_PROXY` | Proxy address | - |
| `CLI_VERSION` | Gemini CLI version for User-Agent header | `0.1.22` |
| `NO_BROWSER` | Set to `true` to suppress automatic browser launch | - |

## API

### Generate Content

```
POST /v1beta/models/{model}:generateContent
POST /v1beta/models/{model}:streamGenerateContent
```

Request body follows the standard Gemini API format:

```bash
curl -X POST http://localhost:3000/v1beta/models/gemini-2.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <PROXY_PASSWORD>" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hello"}]}]
  }'
```

### Model Variant Suffixes

Control behavior via model name suffixes (can be combined):

| Suffix | Effect |
|---|---|
| `-search` | Enable Google Search grounding |
| `-nothinking` | Disable thinking (thinkingBudget=0) |
| `-maxthinking` | Maximum thinking budget (thinkingBudget=24576) |

Examples: `gemini-2.5-flash-search`, `gemini-2.5-pro-nothinking`

### Session Support

Use the `X-Session-Id` request header to maintain multi-turn conversation context (server-side session tracking by Gemini).

```bash
# Create a new session (send empty value; response header returns the assigned session ID)
curl -i -X POST http://localhost:3000/v1beta/models/gemini-2.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: " \
  -d '{"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}'

# Reuse an existing session
curl -X POST http://localhost:3000/v1beta/models/gemini-2.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: <returned-uuid>" \
  -d '{"contents": [{"role": "user", "parts": [{"text": "What did I just say?"}]}]}'
```

Omitting the `X-Session-Id` header uses stateless mode (backward compatible). Sessions expire after 30 minutes of inactivity.

### Session Management

```bash
# List active sessions
GET /sessions

# Delete a session
DELETE /sessions/:id
```

## Detection Risk Analysis

Both gcli2api and the official Gemini CLI use the same underlying transport — `CodeAssistServer` from `@google/gemini-cli-core` — which sends requests to `cloudcode-pa.googleapis.com/v1internal` with identical OAuth tokens and HTTP client behavior. However, there are behavioral differences that could be used for fingerprinting:

| Dimension | Gemini CLI | gcli2api Proxy |
|---|---|---|
| **Endpoint & Auth** | `cloudcode-pa.googleapis.com/v1internal` + OAuth2 | Identical |
| **User-Agent header** | `GeminiCLI/<version> (<platform>; <arch>)` via httpOptions | Matched (hardcoded version, override via `CLI_VERSION` env) |
| **session_id** | Always set for multi-turn tracking | Set when using `X-Session-Id`; `undefined` in stateless mode |
| **user_prompt_id** | Generated internally (UUID) | `crypto.randomUUID()` — same format |
| **Request body** | Rich system prompts, tool declarations (read_file, write_file, shell, grep, glob, etc.), project context | Raw user-provided body — typically just conversation content |
| **tools field** | Declares ~10+ built-in tools for agentic coding | Usually none, or just `googleSearch` |
| **Usage pattern** | Interactive multi-turn with function-calling loops | Typically single request-response |

### Key Differences

1. **User-Agent header** (mitigated): The CLI sends `User-Agent: GeminiCLI/<version> (<platform>; <arch>)` on every request. gcli2api now sets the same header with a hardcoded default version (`0.1.22`). Override via the `CLI_VERSION` environment variable to match the installed `@google/gemini-cli-core` version. The `<platform>` and `<arch>` parts are derived from `process.platform`/`process.arch` at runtime, so they match automatically.

2. **Tool declarations**: The CLI always declares its built-in tool set (file operations, shell, search). The proxy forwards only what the client provides, which is usually nothing. This is the most distinctive signal at the request body level.

3. **System instruction**: The CLI injects detailed system prompts describing the coding assistant persona, project context, and tool usage instructions. The proxy passes through whatever the client sends.

4. **Session ID in stateless mode**: Without `X-Session-Id`, the proxy sends `session_id: undefined`. The real CLI always provides one. Using session support mitigates this.

5. **Request cadence**: The CLI exhibits characteristic function-calling patterns (generate → tool call → tool result → generate). Pure API usage tends to be single-shot or simple multi-turn.

### Mitigation Status

| Signal | Status | Notes |
|---|---|---|
| User-Agent header | **Mitigated** | Hardcoded to `GeminiCLI/0.1.22`; override via `CLI_VERSION` env |
| session_id | **Mitigated** | Use `X-Session-Id` header for session support |
| Tool declarations | Not mitigated | Would require injecting CLI tool schemas into every request |
| System instruction | Not mitigated | Would require replicating CLI's system prompt |
| Request cadence | Not mitigated | Inherent to usage pattern |

With User-Agent and session_id addressed, remaining detection requires **behavioral analysis** of request content patterns, not simple header/field checks.

## Docker

```bash
docker compose up -d
```

Requires mounting `~/.config/google` to reuse existing OAuth credentials.

## Build

```bash
npm run build   # Compile TypeScript to dist/
npm start       # Run compiled output
```

## Tech Stack

- [Hono](https://hono.dev/) — HTTP framework
- [@google/gemini-cli-core](https://www.npmjs.com/package/@google/gemini-cli-core) — Official CLI core library
- TypeScript + Node.js 22
