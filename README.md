# geminicli2api

Gemini CLI to API Proxy — a proxy server built on `@google/gemini-cli-core` that reuses the official CLI's OAuth authentication and `CodeAssistServer` to expose native Gemini API endpoints.

## Quick Start

```bash
npm install
npm run dev
```

On first launch, a Google OAuth login flow will be triggered. Once authenticated, the server listens on `http://localhost:3400`.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GCAPORT` | Listen port | `3400` |
| `GCA_PASSWORD` | API access password (no auth if unset) | - |
| `HTTPS_PROXY` / `HTTP_PROXY` | Proxy address | - |
| `CLI_VERSION` | Gemini CLI version for User-Agent header | `0.36.0` |
| `NO_BROWSER` | Set to `true` to suppress automatic browser launch | - |

## API

### Generate Content

```
POST /v1beta/models/{model}:generateContent
POST /v1beta/models/{model}:streamGenerateContent
```

Request body follows the standard Gemini API format:

Authentication is checked only when `GCA_PASSWORD` is set. Supported formats (standard Gemini API):

| Method | Example |
|---|---|
| `x-goog-api-key` header | `-H "x-goog-api-key: <GCA_PASSWORD>"` |
| `key` query parameter | `?key=<GCA_PASSWORD>` |

```bash
curl -X POST http://localhost:3400/v1beta/models/gemini-2.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: <GCA_PASSWORD>" \
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
curl -i -X POST http://localhost:3400/v1beta/models/gemini-2.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: " \
  -d '{"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}'

# Reuse an existing session
curl -X POST http://localhost:3400/v1beta/models/gemini-2.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: <returned-uuid>" \
  -d '{"contents": [{"role": "user", "parts": [{"text": "What did I just say?"}]}]}'
```

Omitting the `X-Session-Id` header uses stateless mode (backward compatible). Sessions expire after 30 minutes of inactivity.

### Health Check

```
GET /health
```

Returns `{"status": "ok"}`. Useful for Docker/Kubernetes health probes.

### Session Management

```bash
# List active sessions
GET /sessions

# Delete a session
DELETE /sessions/:id
```

## Detection Risk Analysis

Both geminicli2api and the official Gemini CLI use the same underlying transport — `CodeAssistServer` from `@google/gemini-cli-core` — which sends requests to `cloudcode-pa.googleapis.com/v1internal` with identical OAuth tokens and HTTP client behavior. However, there are behavioral differences that could be used for fingerprinting:

| Dimension | Gemini CLI | geminicli2api Proxy |
|---|---|---|
| **Endpoint & Auth** | `cloudcode-pa.googleapis.com/v1internal` + OAuth2 | Identical |
| **User-Agent header** | `GeminiCLI/<version>/<model> (<platform>; <arch>; <surface>)` via httpOptions | Matched (hardcoded version, override via `CLI_VERSION` env) |
| **session_id** | Always set for multi-turn tracking | Set when using `X-Session-Id`; `undefined` in stateless mode |
| **user_prompt_id** | Generated internally (UUID) | `crypto.randomUUID()` — same format |
| **Request body** | Rich system prompts, tool declarations (read_file, write_file, shell, grep, glob, etc.), project context | Raw user-provided body — typically just conversation content |
| **tools field** | Declares ~10+ built-in tools for agentic coding | Usually none, or just `googleSearch` |
| **Usage pattern** | Interactive multi-turn with function-calling loops | Typically single request-response |

### Key Differences

1. **User-Agent header** (mitigated): The CLI sends `User-Agent: GeminiCLI/<version>/<model> (<platform>; <arch>; <surface>)` on every request. geminicli2api now sets the same header with a hardcoded default version (`0.36.0`) and surface (`terminal`). Override via the `CLI_VERSION` environment variable to match the installed `@google/gemini-cli-core` version. The `<platform>` and `<arch>` parts are derived from `process.platform`/`process.arch` at runtime, so they match automatically.

2. **Tool declarations**: The CLI always declares its built-in tool set (file operations, shell, search). The proxy forwards only what the client provides, which is usually nothing. This is the most distinctive signal at the request body level.

3. **System instruction**: The CLI injects detailed system prompts describing the coding assistant persona, project context, and tool usage instructions. The proxy passes through whatever the client sends.

4. **Session ID in stateless mode**: Without `X-Session-Id`, the proxy sends `session_id: undefined`. The real CLI always provides one. Using session support mitigates this.

5. **Request cadence**: The CLI exhibits characteristic function-calling patterns (generate → tool call → tool result → generate). Pure API usage tends to be single-shot or simple multi-turn.

### Mitigation Status

| Signal | Status | Notes |
|---|---|---|
| User-Agent header | **Mitigated** | Hardcoded to `GeminiCLI/0.36.0`; override via `CLI_VERSION` env |
| session_id | **Mitigated** | Use `X-Session-Id` header for session support |
| Tool declarations | Not mitigated | Would require injecting CLI tool schemas into every request |
| System instruction | Not mitigated | Would require replicating CLI's system prompt |
| Request cadence | Not mitigated | Inherent to usage pattern |

With User-Agent and session_id addressed, remaining detection requires **behavioral analysis** of request content patterns, not simple header/field checks.

## Docker Compose

```bash
docker compose up -d
```

### First-time login

The first launch will fail because OAuth credentials don't exist yet. You need to manually exec into the container to complete Google login:

```bash
# 1. Start the container (it will crash-loop waiting for auth)
docker compose up -d

# 2. Exec into the container and run gemini CLI to trigger OAuth login
docker compose exec geminicli2api gemini

# 3. Follow the terminal prompts to complete Google OAuth login
#    Credentials will be saved to the gemini-data volume at /root/.gemini/

# 4. Restart the container
docker compose restart geminicli2api
```

After login, credentials are persisted in the `gemini-data` Docker volume and will be reused automatically on subsequent restarts.

## Build

```bash
npm run build   # Compile TypeScript to dist/
npm start       # Run compiled output
```

## Tech Stack

- [Hono](https://hono.dev/) — HTTP framework
- [@google/gemini-cli-core](https://www.npmjs.com/package/@google/gemini-cli-core) — Official CLI core library
- TypeScript + Node.js 22
