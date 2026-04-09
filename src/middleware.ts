import type { Context, Next } from 'hono';

export async function authMiddleware(c: Context, next: Next) {
  const password = process.env.GCA_PASSWORD;
  if (!password) {
    return next();
  }

  const token =
    c.req.header('x-goog-api-key') ??
    c.req.query('key');

  if (!token) {
    return c.json({ error: 'Missing API key' }, 401);
  }

  if (token !== password) {
    return c.json({ error: 'Invalid API key' }, 403);
  }

  return next();
}
