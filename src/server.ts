import { Hono } from 'hono';
import { routes } from './routes.js';

const app = new Hono();

app.onError((err, c) => {
  console.error('[app error]', err);
  return c.json({ error: String(err) }, 500);
});

app.use('*', async (c, next) => {
  console.log(`[req] ${c.req.method} ${c.req.path}`);
  await next();
});

app.route('/', routes);

export { app };
