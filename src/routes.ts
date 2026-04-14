import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from './middleware.js';
import { createServer } from './credentials.js';
import { getOrCreateSession, getOrCreateServer, listSessions, deleteSession } from './session.js';
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

/** Set upstream headers + session header on the outgoing response. */
function setResponseHeaders(
  c: { header: (k: string, v: string) => void },
  upstream: Record<string, string>,
  sessionId?: string,
) {
  for (const [k, v] of Object.entries(upstream)) {
    c.header(k, v);
  }
  if (sessionId) {
    c.header('X-Session-Id', sessionId);
  }
}

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
    let server;

    if (requestSessionId !== undefined) {
      isTrackedSession = true;
      const session = getOrCreateSession(requestSessionId || undefined);
      sessionId = session.id;
      server = getOrCreateServer(session, baseModel);
    } else {
      sessionId = crypto.randomUUID();
      server = createServer(baseModel, sessionId);
    }

    console.log(`[${action}] baseModel=${baseModel} useSearch=${useSearch} thinkingBudget=${thinkingBudget} session=${sessionId}${isTrackedSession ? ' (tracked)' : ' (stealth)'}`);

    if (action === 'streamGenerateContent' || c.req.query('alt') === 'sse') {
      const { headers, stream } = await server.streamRaw(params as never, userPromptId);

      setResponseHeaders(c, headers, isTrackedSession ? sessionId : undefined);

      return streamSSE(c, async (sseStream) => {
        try {
          for await (const chunk of stream) {
            await sseStream.writeSSE({ data: JSON.stringify(chunk) });
          }
        } catch (err: any) {
          console.error(`[${action}] stream error:`, err);
        }
      });
    } else if (action === 'generateContent') {
      const { headers, body: responseBody } = await server.requestRaw(params as never, userPromptId);

      setResponseHeaders(c, headers, isTrackedSession ? sessionId : undefined);

      return c.json(responseBody as object);
    } else {
      return c.json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    const status = err?.status ?? err?.code ?? 500;
    let upstream = err?.response?.data;

    if (typeof upstream === 'string') {
      try {
        upstream = JSON.parse(upstream);
      } catch {
        upstream = { error: upstream };
      }
    }

    console.error(`[${action}] error (${status}):`, err);
    return c.json(upstream ?? { error: String(err) }, status);
  }
});

export { routes };
