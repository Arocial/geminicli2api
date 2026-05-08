import crypto from 'node:crypto';
import type { ProxyCodeAssistServer } from './proxy-server.js';
import { createServer } from './credentials.js';

interface Session {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  /** Cached CodeAssistServer instances keyed by baseModel */
  servers: Map<string, ProxyCodeAssistServer>;
  lastUserMsgCnt: number;
  lastReportTurn: number;
  historyHashes: Set<string>;
}

const sessions = new Map<string, Session>();
const historyHashToSessionId = new Map<string, string>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // cleanup every 5 minutes

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastUsedAt > SESSION_TTL_MS) {
      for (const hash of session.historyHashes) {
        historyHashToSessionId.delete(hash);
      }
      sessions.delete(key);
      console.log(`[session] expired: ${key}`);
    }
  }
}, CLEANUP_INTERVAL_MS);

export function calculateHistoryHash(
  contents: any[],
  excludeLast: boolean,
  identity: string,
): string | null {
  if (!contents || !Array.isArray(contents)) return null;

  const userTexts: string[] = [];
  for (const msg of contents) {
    if (msg.role === 'user' && Array.isArray(msg.parts)) {
      const text = msg.parts.map((p: any) => p.text || '').join('');
      userTexts.push(text);
    }
  }

  if (excludeLast && userTexts.length > 0) {
    userTexts.pop();
  }

  if (userTexts.length === 0) {
    return null;
  }

  const combined = identity + '\n###\n' + userTexts.join('\n---\n');
  return crypto.createHash('sha256').update(combined).digest('hex');
}

export function getOrCreateSession(
  sessionId?: string,
  track?: boolean,
  historyHash?: string | null,
  newHistoryHash?: string | null,
): Session {
  let resolvedSessionKey = sessionId;

  // Fallback to history hash if no sessionId provided
  if (!resolvedSessionKey && historyHash) {
    const foundKey = historyHashToSessionId.get(historyHash);
    if (foundKey && sessions.has(foundKey)) {
      resolvedSessionKey = foundKey;
      console.log(
        `[session] fallback matched hash: ${historyHash.substring(0, 8)} -> ${resolvedSessionKey}`,
      );
    }
  }

  // Reuse existing session
  if (resolvedSessionKey && sessions.has(resolvedSessionKey)) {
    const session = sessions.get(resolvedSessionKey)!;
    session.lastUsedAt = Date.now();

    if (newHistoryHash) {
      session.historyHashes.add(newHistoryHash);
      historyHashToSessionId.set(newHistoryHash, resolvedSessionKey);
    }

    console.log(`[session] reuse: ${resolvedSessionKey}`);
    return session;
  }

  // Create new session — always use UUID as the internal id
  const key = resolvedSessionKey || crypto.randomUUID();
  const id = crypto.randomUUID();

  const session: Session = {
    id,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    servers: new Map(),
    lastUserMsgCnt: -1,
    lastReportTurn: -1,
    historyHashes: new Set(),
  };

  if (newHistoryHash) {
    session.historyHashes.add(newHistoryHash);
    historyHashToSessionId.set(newHistoryHash, key);
  }

  if (track) {
    sessions.set(key, session);
  }
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
  const session = sessions.get(sessionId);
  if (session) {
    for (const hash of session.historyHashes) {
      historyHashToSessionId.delete(hash);
    }
  }
  const deleted = sessions.delete(sessionId);
  if (deleted) {
    console.log(`[session] deleted: ${sessionId}`);
  }
  return deleted;
}

/**
 * Analyzes the conversation contents to determine if it's the user's turn
 * and calculates the current turn index.
 */
export function analyzeTurn(contents: any[], session: Session) {
  const lastMessage = contents[contents.length - 1];
  const isUserTurn =
    lastMessage?.role === 'user' && lastMessage.parts?.some((p: any) => 'text' in p);
  const userMsgCnt = contents.filter(
    (m: any) => m.role === 'user' && m.parts?.some((p: any) => 'text' in p),
  ).length;
  if (userMsgCnt > session.lastUserMsgCnt) {
    session.lastUserMsgCnt = userMsgCnt;
    session.lastReportTurn++;
  }
  const turn = session.lastReportTurn;
  return { isUserTurn, turn };
}
