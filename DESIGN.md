# geminicli2api - Gemini CLI to API Proxy

## Overview

基于 `@google/gemini-cli-core` 的 Gemini API 代理服务，复用官方 CLI 的认证、onboarding 和 API 通信逻辑，无需逆向工程。仅对外提供原生 Gemini API。

## Project Structure

```
geminicli2api/
├── src/
│   ├── index.ts              # 入口，启动服务
│   ├── server.ts             # Hono 应用，路由注册
│   ├── credentials.ts        # 封装 gemini-cli-core 认证 + onboarding
│   ├── middleware.ts          # 代理密码校验中间件
│   ├── routes.ts             # /v1beta/models/... 路由
│   └── config.ts             # 模型变体解析、安全设置注入
├── package.json
├── tsconfig.json
├── Dockerfile
└── docker-compose.yml
```

## Dependencies

- `@google/gemini-cli-core` — 认证、onboarding、API 通信
- `hono` — HTTP 框架
- `@hono/node-server` — Node.js 适配器

## Core Modules

### credentials.ts

封装 gemini-cli-core 的认证和 onboarding 流程。

```typescript
import { getOauthClient, setupUser, CodeAssistServer, Config, AuthType } from '@google/gemini-cli-core';

let server: CodeAssistServer;

export async function initServer() {
  const config = new Config();
  const authClient = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
  const userData = await setupUser(authClient, config);
  server = new CodeAssistServer(authClient, userData.projectId, undefined, undefined, userData.userTier);
  return server;
}

export function getServer() { return server; }
```

### middleware.ts

通过环境变量 `PROXY_PASSWORD` 进行简单的密码校验中间件。

### routes.ts

核心路由，处理 generateContent 和 streamGenerateContent 请求。

```typescript
app.post('/v1beta/models/:model{.+}\\::action', authMiddleware, async (c) => {
  const model = c.req.param('model');
  const action = c.req.param('action');
  const body = await c.req.json();

  const { baseModel, useSearch, thinkingBudget } = parseModelVariant(model);
  injectDefaults(body, { useSearch, thinkingBudget });

  const server = getServer();

  if (action === 'streamGenerateContent') {
    const stream = server.generateContentStream(body);
    return streamSSE(c, stream);
  } else {
    const response = await server.generateContent(body);
    return c.json(response);
  }
});
```

### config.ts (~50 lines)

模型变体解析和安全设置注入：

- **模型变体后缀**：
  - `-search` — 启用 Google Search grounding（注入 `tools: [{googleSearch: {}}]`）
  - `-nothinking` — 关闭思考（`thinkingBudget: 0`）
  - `-maxthinking` — 最大思考预算（`thinkingBudget: 24576`）
- **安全设置**：所有类别设置为 `BLOCK_NONE`
- **默认思考配置**：`includeThoughts: true`, `thinkingBudget: 8192`

### server.ts (~20 lines)

创建 Hono 应用实例，注册路由。

### index.ts (~10 lines)

入口文件：初始化认证 → 启动 HTTP 服务。

## Key Design Decisions

1. **直接依赖 gemini-cli-core**：消除所有逆向工程代码，升级只需 `npm update`
2. **仅原生 Gemini API**：不包含 OpenAI 兼容层，减少复杂度
3. **SSE streaming**：POST `?alt=sse`，解析 `data:` 行
4. **CodeAssistServer 内置重试**：自动处理 429/5xx 错误

## Implementation Steps

1. 初始化项目 + 安装依赖
2. 实现认证 + onboarding (credentials.ts)
3. 实现 generateContent / streamGenerateContent 透传 (routes.ts)
4. 实现模型变体解析 + 安全设置注入 (config.ts)
5. 实现密码校验中间件 (middleware.ts)
6. Docker 支持

