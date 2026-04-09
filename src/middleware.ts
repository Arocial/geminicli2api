import type { Context, Next } from 'hono';

export async function authMiddleware(c: Context, next: Next) {
  const password = process.env.GCA_PASSWORD;
  if (!password) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== password) {
    return c.json({ error: 'Invalid credentials' }, 403);
  }

  return next();
}
