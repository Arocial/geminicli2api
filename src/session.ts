import crypto from 'node:crypto';
import type { ProxyCodeAssistServer } from './proxy-server.js';
import { createServer } from './credentials.js';

interface Session {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  /** Cached CodeAssistServer instances keyed by baseModel */
  servers: Map<string, ProxyCodeAssistServer>;
}

const sessions = new Map<string, Session>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // cleanup every 5 minutes

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > SESSION_TTL_MS) {
      sessions.delete(id);
      console.log(`[session] expired: ${id}`);
    }
  }
}, CLEANUP_INTERVAL_MS);


export function getOrCreateSession(sessionId?: string): Session {
  // Reuse existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastUsedAt = Date.now();
    console.log(`[session] reuse: ${sessionId}`);
    return session;
  }

  // Create new session — always use UUID as the internal id
  const key = sessionId || crypto.randomUUID();
  const id = crypto.randomUUID();

  const session: Session = {
    id,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    servers: new Map(),
  };

  sessions.set(key, session);
  console.log(`[session] created: ${id} (key=${key}, total: ${sessions.size})`);
  return session;
}

/**
 * Get or create a CodeAssistServer for the given session and model.
 * Reuses existing server instances per session+model pair, matching
 * the official gemini-cli behavior (one server per session).
 */
export function getOrCreateServer(session: Session, baseModel: string): ProxyCodeAssistServer {
  let server = session.servers.get(baseModel);
  if (!server) {
    server = createServer(baseModel, session.id);
    session.servers.set(baseModel, server);
    console.log(`[session] new server: model=${baseModel} session=${session.id}`);
  }
  return server;
}

export function listSessions(): { id: string; createdAt: number; lastUsedAt: number }[] {
  return Array.from(sessions.values()).map(({ id, createdAt, lastUsedAt }) => ({
    id,
    createdAt,
    lastUsedAt,
  }));
}

export function deleteSession(sessionId: string): boolean {
  const deleted = sessions.delete(sessionId);
  if (deleted) {
    console.log(`[session] deleted: ${sessionId}`);
  }
  return deleted;
}
