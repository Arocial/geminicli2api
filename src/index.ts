import { serve } from '@hono/node-server';
import { app } from './server.js';
import { initServer } from './credentials.js';

const port = parseInt(process.env.GCA_PORT ?? '3400', 10);

await initServer();
console.log(`geminicli2api listening on port ${port}`);
serve({
  fetch: async (req, info) => {
    console.log(`[serve] ${req.method} ${req.url}`);
    try {
      const res = await app.fetch(req, info);
      console.log(`[serve] response status: ${res.status}`);
      return res;
    } catch (e) {
      console.error(`[serve] app.fetch threw:`, e);
      return new Response('internal error', { status: 500 });
    }
  },
  port,
});
