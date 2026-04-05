import { getOauthClient, AuthType, CodeAssistServer } from '@google/gemini-cli-core';
// setupUser is not re-exported from the main index
import { setupUser } from '@google/gemini-cli-core/dist/src/code_assist/setup.js';
import type { OAuth2Client } from 'google-auth-library';
import type { UserTierId } from '@google/gemini-cli-core/dist/src/code_assist/types.js';

// Match the User-Agent header sent by the real Gemini CLI.
// Format: GeminiCLI/<version> (<platform>; <arch>)
// Update this when upgrading @google/gemini-cli-core.
const DEFAULT_CLI_VERSION = '0.1.22';
const cliVersion = process.env.CLI_VERSION || DEFAULT_CLI_VERSION;
export const cliHttpOptions = {
  headers: {
    'User-Agent': `GeminiCLI/${cliVersion} (${process.platform}; ${process.arch})`,
  },
};

let authClient: OAuth2Client;
let projectId: string;
let userTier: UserTierId | undefined;
let defaultServer: CodeAssistServer;

// getOauthClient only uses config.getProxy() and config.isBrowserLaunchSuppressed()
function createMinimalConfig() {
  return {
    getProxy: () => process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined,
    isBrowserLaunchSuppressed: () =>
      process.env.NO_BROWSER === 'true' || process.env.NO_BROWSER === '1',
  };
}

export async function initServer(): Promise<CodeAssistServer> {
  const config = createMinimalConfig();
  authClient = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config as never);
  const userData = await setupUser(authClient);
  projectId = userData.projectId;
  userTier = userData.userTier;
  defaultServer = new CodeAssistServer(
    authClient,
    projectId,
    cliHttpOptions,
    undefined,
    userTier,
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
