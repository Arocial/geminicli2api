import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from './middleware.js';
import {
  analyzeTurn,
  getOrCreateSession,
  getOrCreateServer,
  listSessions,
  deleteSession,
  calculateHistoryHash,
} from './session.js';
import { parseModelVariant, toGenerateContentParams } from './config.js';

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

    const contents = body.contents || [];

    // Session support: use X-Session-Id header to maintain conversation context
    const requestSessionId = c.req.header('X-Session-Id');
    const identity = c.req.header('Authorization') || '';

    const historyHash = calculateHistoryHash(contents, true, identity);
    const newHistoryHash = calculateHistoryHash(contents, false, identity);

    const isTrackedSession = requestSessionId !== undefined || newHistoryHash !== null;
    const session = getOrCreateSession(
      requestSessionId || undefined,
      isTrackedSession,
      historyHash,
      newHistoryHash,
    );
    const sessionId = session.id;
    const server = getOrCreateServer(session, baseModel);

    const { isUserTurn, turn } = analyzeTurn(contents, session);

    const userPromptId = `${sessionId}########${turn}`;

    console.log(
      `[${action}] baseModel=${baseModel} useSearch=${useSearch} thinkingBudget=${thinkingBudget} session=${sessionId}${isTrackedSession ? ' (tracked)' : ' (stealth)'}`,
    );

    const clientSignal = c.req.raw.signal;

    if (isUserTurn) {
      try {
        await server.retrieveUserQuota({ project: (server as any).projectId } as never);
      } catch {
        // ignore
      }
    }

    if (action === 'streamGenerateContent' || c.req.query('alt') === 'sse') {
      const { stream } = await server.streamRaw(params as never, userPromptId, clientSignal);

      if (requestSessionId !== undefined) {
        c.header('X-Session-Id', sessionId);
      }

      return streamSSE(c, async (sseStream) => {
        try {
          for await (const chunk of stream) {
            if (clientSignal.aborted) break;
            await sseStream.writeSSE({ data: JSON.stringify(chunk) });
          }
        } catch (err: any) {
          if (clientSignal.aborted) {
            console.log(`[${action}] client disconnected, upstream aborted`);
            return;
          }
          console.error(`[${action}] stream error:`, err);
          const code = err?.code === 'ECONNRESET' ? 502 : err?.code === 'ETIMEDOUT' ? 504 : 500;
          const errorEvent = {
            error: {
              code,
              message: `Upstream connection error: ${err?.code || err?.message || 'unknown'}`,
              status:
                code === 502 ? 'BAD_GATEWAY' : code === 504 ? 'DEADLINE_EXCEEDED' : 'INTERNAL',
            },
          };
          try {
            await sseStream.writeSSE({ data: JSON.stringify(errorEvent) });
          } catch {
            // Client already disconnected, nothing we can do
          }
        }
      });
    } else if (action === 'generateContent') {
      const { status, body: responseBody } = await server.requestRaw(
        params as never,
        userPromptId,
        clientSignal,
      );

      if (requestSessionId !== undefined) {
        c.header('X-Session-Id', sessionId);
      }

      return c.json(responseBody as object, status as 200);
    } else {
      return c.json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    if (c.req.raw.signal.aborted) {
      console.log(`[${action}] client disconnected, upstream aborted`);
      return c.body(null, 499 as 200);
    }
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
