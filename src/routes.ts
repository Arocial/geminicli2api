import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { LlmRole } from '@google/gemini-cli-core';
import { authMiddleware } from './middleware.js';
import { createServer } from './credentials.js';
import { getOrCreateSession, listSessions, deleteSession } from './session.js';
import { parseModelVariant, toGenerateContentParams } from './config.js';
import crypto from 'node:crypto';

const routes = new Hono();

// Session management endpoints
routes.get('/sessions', authMiddleware, (c) => {
  return c.json(listSessions());
});

routes.delete('/sessions/:id', authMiddleware, (c) => {
  const id = c.req.param('id')!;
  const deleted = deleteSession(id);
  return deleted ? c.json({ ok: true }) : c.json({ error: 'Session not found' }, 404);
});

routes.post('/v1beta/models/*', authMiddleware, async (c) => {
  const rest = c.req.path.replace('/v1beta/models/', '');
  const colonIdx = rest.lastIndexOf(':');
  if (colonIdx === -1) {
    return c.json({ error: 'Missing :action in path' }, 400);
  }
  const model = rest.slice(0, colonIdx);
  const action = rest.slice(colonIdx + 1);

  console.log(`[${action}] model=${model}`);

  try {
    const body = await c.req.json();
    const { baseModel, useSearch, thinkingBudget } = parseModelVariant(model);
    const params = toGenerateContentParams(baseModel, body, { useSearch, thinkingBudget });
    const userPromptId = crypto.randomUUID();

    // Session support: use X-Session-Id header to maintain conversation context
    const requestSessionId = c.req.header('X-Session-Id');
    let sessionId: string;
    let isTrackedSession = false;

    if (requestSessionId !== undefined) {
      // Client wants session support (even empty string means "create new session")
      const session = getOrCreateSession(requestSessionId || undefined);
      sessionId = session.id;
      isTrackedSession = true;
    } else {
      // Stateless mode: force a random session ID for stealth, but don't track it in memory
      sessionId = crypto.randomUUID();
    }

    // Dynamically create server to ensure User-Agent matches the requested model
    const server = createServer(baseModel, sessionId);

    console.log(`[${action}] baseModel=${baseModel} useSearch=${useSearch} thinkingBudget=${thinkingBudget} session=${sessionId}${isTrackedSession ? ' (tracked)' : ' (stealth)'}`);

    if (action === 'streamGenerateContent' || c.req.query('alt') === 'sse') {
      // Await the generator creation outside streamSSE to catch initial errors (like 429)
      const gen = await server.generateContentStream(params as never, userPromptId, LlmRole.MAIN);

      // Set session ID header for streaming responses if it's a tracked session
      if (isTrackedSession) {
        c.header('X-Session-Id', sessionId);
      }

      return streamSSE(c, async (stream) => {
        try {
          for await (const chunk of gen) {
            await stream.writeSSE({ data: JSON.stringify(chunk) });
          }
        } catch (err: any) {
          console.error(`[${action}] stream iteration error:`, err);
          // If an error occurs during streaming, we can't change the HTTP status code anymore.
          // We can only close the stream or send an error event.
          // Standard Gemini API doesn't have a standard SSE error format, so we just end the stream.
        }
      });
    } else if (action === 'generateContent') {
      const response = await server.generateContent(params as never, userPromptId, LlmRole.MAIN);
      if (isTrackedSession) {
        c.header('X-Session-Id', sessionId);
      }
      return c.json(response);
    } else {
      return c.json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    const status = err?.status ?? err?.code ?? 500;
    let upstream = err?.response?.data;
    
    if (typeof upstream === 'string') {
      try {
        upstream = JSON.parse(upstream);
      } catch (e) {
        upstream = { error: upstream };
      }
    }
    
    console.error(`[${action}] error (${status}):`, err);
    return c.json(upstream ?? { error: String(err) }, status);
  }
});

export { routes };
