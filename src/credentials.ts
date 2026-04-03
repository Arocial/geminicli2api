import { getOauthClient, AuthType, CodeAssistServer } from '@google/gemini-cli-core';
// setupUser is not re-exported from the main index
import { setupUser } from '@google/gemini-cli-core/dist/src/code_assist/setup.js';

let server: CodeAssistServer;

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
  const authClient = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config as never);
  const userData = await setupUser(authClient);
  server = new CodeAssistServer(
    authClient,
    userData.projectId,
    undefined,
    undefined,
    userData.userTier,
  );
  return server;
}

export function getServer(): CodeAssistServer {
  return server;
}
