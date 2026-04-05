import {
  getOauthClient,
  AuthType,
  CodeAssistServer,
  setupUser,
  coreEvents,
  CoreEvent,
} from '@google/gemini-cli-core';
import type { UserTierId, GeminiUserTier } from '@google/gemini-cli-core/dist/src/code_assist/types.js';

// Match the User-Agent header sent by the real Gemini CLI (v0.36.0+).
// Format: GeminiCLI/<version>/<model> (<platform>; <arch>; <surface>)
// The model placeholder is filled per-request; here we use a default.
// Update DEFAULT_CLI_VERSION when upgrading @google/gemini-cli-core.
const DEFAULT_CLI_VERSION = '0.36.0';
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
let defaultServer: CodeAssistServer;

// Minimal config to satisfy getOauthClient and setupUser requirements.
// getOauthClient uses: getProxy(), isBrowserLaunchSuppressed()
// setupUser uses: getValidationHandler()
function createMinimalConfig() {
  return {
    getProxy: () => process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined,
    isBrowserLaunchSuppressed: () =>
      process.env.NO_BROWSER === 'true' || process.env.NO_BROWSER === '1',
    getValidationHandler: () => undefined,
  };
}

export async function initServer(): Promise<CodeAssistServer> {
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
  defaultServer = new CodeAssistServer(
    authClient,
    projectId,
    cliHttpOptions,
    undefined,
    userTier,
    userTierName,
    paidTier,
  );
  return defaultServer;
}

/** Default server without session (backward compatible) */
export function getServer(): CodeAssistServer {
  return defaultServer;
}

/** Expose auth primitives for session-scoped server creation */
export function getAuthClient() { return authClient; }
export function getProjectId() { return projectId; }
export function getUserTier() { return userTier; }
export function getUserTierName() { return userTierName; }
export function getPaidTier() { return paidTier; }
