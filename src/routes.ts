import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from './middleware.js';
import { getServer } from './credentials.js';
import { parseModelVariant, toGenerateContentParams } from './config.js';
import crypto from 'node:crypto';

const routes = new Hono();

// Debug: log all incoming requests
routes.use('*', async (c, next) => {
  console.log(`[incoming] ${c.req.method} ${c.req.path}`);
  await next();
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
    const server = getServer();

    console.log(`[${action}] baseModel=${baseModel} useSearch=${useSearch} thinkingBudget=${thinkingBudget}`);

    if (action === 'streamGenerateContent') {
      return streamSSE(c, async (stream) => {
        const gen = await server.generateContentStream(params as never, userPromptId);
        for await (const chunk of gen) {
          await stream.writeSSE({ data: JSON.stringify(chunk) });
        }
      });
    } else if (action === 'generateContent') {
      const response = await server.generateContent(params as never, userPromptId);
      return c.json(response);
    } else {
      return c.json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error(`[${action}] error:`, err);
    return c.json({ error: String(err) }, 500);
  }
});

export { routes };
