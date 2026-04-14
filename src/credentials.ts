import { createRequire } from 'module';
import {
  getOauthClient,
  AuthType,
  setupUser,
  coreEvents,
  CoreEvent,
  UserAccountManager,
} from '@google/gemini-cli-core';
import { ProxyCodeAssistServer } from './proxy-server.js';
import type { UserTierId, GeminiUserTier } from '@google/gemini-cli-core/dist/src/code_assist/types.js';

const require = createRequire(import.meta.url);
const { version: DEFAULT_CLI_VERSION } = require('@google/gemini-cli-core/package.json');

// Match the User-Agent header sent by the real Gemini CLI.
// Format: GeminiCLI/<version>/<model> (<platform>; <arch>; <surface>)
// The model placeholder is filled per-request; here we use a default.
const cliVersion = process.env.CLI_VERSION || DEFAULT_CLI_VERSION;

export function buildHttpOptions(model = 'gemini-2.5-flash') {
  return {
    headers: {
      'User-Agent': `GeminiCLI/${cliVersion}/${model} (${process.platform}; ${process.arch}; terminal)`,
    },
  };
}

// Default httpOptions (used when model is unknown at init time)
export const cliHttpOptions = buildHttpOptions();

let authClient: any;
let projectId: string;
let userTier: UserTierId | undefined;
let userTierName: string | undefined;
let paidTier: GeminiUserTier | undefined;

// Minimal config to satisfy getOauthClient and setupUser requirements.
// getOauthClient uses: getProxy(), isBrowserLaunchSuppressed()
// setupUser uses: getValidationHandler()
function createMinimalConfig() {
  return {
    getProxy: () => process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined,
    isBrowserLaunchSuppressed: () =>
      process.env.NO_BROWSER === 'true' || process.env.NO_BROWSER === '1',
    getValidationHandler: () => undefined,
    getAcpMode: () => false,
    isInteractive: () => true,
  };
}

export interface AuthInfo {
  email: string | null;
  tierName: string | undefined;
}

export async function initServer(): Promise<AuthInfo> {
  // Auto-confirm OAuth consent prompts (new in v0.36.0)
  coreEvents.on(CoreEvent.ConsentRequest, (payload: { onConfirm: (v: boolean) => void }) => {
    console.log('[auth] Auto-confirming consent request');
    payload.onConfirm(true);
  });

  const config = createMinimalConfig();
  authClient = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config as never);
  const userData = await setupUser(authClient, config as never, cliHttpOptions);
  projectId = userData.projectId;
  userTier = userData.userTier;
  userTierName = userData.userTierName;
  paidTier = userData.paidTier;

  const accountManager = new UserAccountManager();
  const email = accountManager.getCachedGoogleAccount();

  return { email, tierName: userTierName };
}

/** Dynamically create a server instance with the correct User-Agent and Session ID */
export function createServer(model: string, sessionId: string): ProxyCodeAssistServer {
  return new ProxyCodeAssistServer(
    authClient,
    projectId,
    buildHttpOptions(model),
    sessionId,
    userTier,
    userTierName,
    paidTier,
  );
}
