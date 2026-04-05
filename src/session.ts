import { CodeAssistServer } from '@google/gemini-cli-core';
import { getAuthClient, getProjectId, getUserTier, cliHttpOptions } from './credentials.js';
import crypto from 'node:crypto';

interface Session {
  id: string;
  server: CodeAssistServer;
  createdAt: number;
  lastUsedAt: number;
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

  // Create new session
  const id = sessionId || crypto.randomUUID();
  const server = new CodeAssistServer(
    getAuthClient(),
    getProjectId(),
    cliHttpOptions,
    id,
    getUserTier(),
  );

  const session: Session = {
    id,
    server,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  sessions.set(id, session);
  console.log(`[session] created: ${id} (total: ${sessions.size})`);
  return session;
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
