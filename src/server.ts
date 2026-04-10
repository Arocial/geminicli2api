import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { routes } from './routes.js';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

app.onError((err, c) => {
  console.error('[app error]', err);
  return c.json({ error: String(err) }, 500);
});

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/', routes);

export { app };
