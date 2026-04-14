import { CodeAssistServer } from '@google/gemini-cli-core';
import { toGenerateContentRequest } from '@google/gemini-cli-core/dist/src/code_assist/converter.js';
import type { GenerateContentParameters } from '@google/genai';
import * as readline from 'node:readline';
import { Readable } from 'node:stream';

/**
 * Extends CodeAssistServer to expose raw streaming and unary access
 * to the v1internal endpoint, bypassing the SDK's response conversion layer.
 *
 * This lets the proxy forward Google's SSE chunks directly to clients
 * with only the minimal unwrap of the `{ response }` envelope.
 */
export class ProxyCodeAssistServer extends CodeAssistServer {

  /**
   * Stream: returns an async generator that yields raw `response` objects
   * straight from the v1internal SSE stream — no GenerateContentResponse
   * class conversion, no telemetry side-effects.
   */
  async *streamRaw(
    req: GenerateContentParameters,
    userPromptId: string,
  ): AsyncGenerator<unknown> {
    const wireReq = toGenerateContentRequest(
      req, userPromptId, this.projectId, this.sessionId, undefined,
    );

    const res = await this.client.request({
      url: this.getMethodUrl('streamGenerateContent'),
      method: 'POST',
      params: { alt: 'sse' },
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'stream',
      body: JSON.stringify(wireReq),
      retry: false,
    });

    const rl = readline.createInterface({
      input: Readable.from(res.data as AsyncIterable<Buffer>),
      crlfDelay: Infinity,
    });

    let bufferedLines: string[] = [];
    for await (const line of rl) {
      if (line.startsWith('data: ')) {
        bufferedLines.push(line.slice(6).trim());
      } else if (line === '') {
        if (bufferedLines.length === 0) continue;
        const chunk = bufferedLines.join('\n');
        bufferedLines = [];
        try {
          const parsed = JSON.parse(chunk);
          // Unwrap the v1internal envelope — yield only the inner response
          yield parsed.response ?? parsed;
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  /**
   * Unary: sends a non-streaming request and returns the raw `response`
   * object, with retry on 429/5xx (matching CodeAssistServer behavior).
   */
  async requestRaw(
    req: GenerateContentParameters,
    userPromptId: string,
  ): Promise<unknown> {
    const wireReq = toGenerateContentRequest(
      req, userPromptId, this.projectId, this.sessionId, undefined,
    );

    const res = await this.requestPost<{ response?: unknown }>(
      'generateContent', wireReq,
    );
    return res.response ?? res;
  }
}
