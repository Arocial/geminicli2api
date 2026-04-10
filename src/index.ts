import { serve } from '@hono/node-server';
import { app } from './server.js';
import { initServer } from './credentials.js';

const port = parseInt(process.env.GCA_PORT ?? '3400', 10);

await initServer();
console.log(`geminicli2api listening on port ${port}`);
serve({
  fetch: async (req, info) => {
    try {
      const res = await app.fetch(req, info);
      return res;
    } catch (e) {
      return new Response('internal error', { status: 500 });
    }
  },
  port,
});
