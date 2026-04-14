import { CodeAssistServer } from '@google/gemini-cli-core';
import { toGenerateContentRequest } from '@google/gemini-cli-core/dist/src/code_assist/converter.js';
import type { GenerateContentParameters } from '@google/genai';
import * as readline from 'node:readline';
import { Readable } from 'node:stream';

export interface RawStreamResult {
  status: number;
  headers: Record<string, string>;
  stream: AsyncGenerator<unknown>;
}

export interface RawUnaryResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Headers worth forwarding from the upstream v1internal response. */
const PASSTHROUGH_HEADERS = [
  'x-request-id',
  'x-goog-request-id',
  'x-debug-tracking-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'grpc-status',
  'grpc-message',
];

function pickHeaders(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PASSTHROUGH_HEADERS) {
    const v = raw[key];
    if (v != null) out[key] = String(v);
  }
  return out;
}

/**
 * Extends CodeAssistServer to expose raw streaming and unary access
 * to the v1internal endpoint, bypassing the SDK's response conversion layer.
 */
export class ProxyCodeAssistServer extends CodeAssistServer {

  /**
   * Stream: returns upstream headers + an async generator that yields raw
   * `response` objects straight from the v1internal SSE stream.
   */
  async streamRaw(
    req: GenerateContentParameters,
    userPromptId: string,
  ): Promise<RawStreamResult> {
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

    const status = res.status;
    const headers = pickHeaders(res.headers ?? {});

    async function* parseSSE(data: AsyncIterable<Buffer>) {
      const rl = readline.createInterface({
        input: Readable.from(data),
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
            yield parsed.response ?? parsed;
          } catch {
            // skip malformed chunks
          }
        }
      }
    }

    return {
      status,
      headers,
      stream: parseSSE(res.data as AsyncIterable<Buffer>),
    };
  }

  /**
   * Unary: sends a non-streaming request and returns upstream headers +
   * the raw `response` object, with retry on 429/5xx.
   */
  async requestRaw(
    req: GenerateContentParameters,
    userPromptId: string,
  ): Promise<RawUnaryResult> {
    const wireReq = toGenerateContentRequest(
      req, userPromptId, this.projectId, this.sessionId, undefined,
    );

    // requestPost returns parsed JSON directly (no access to headers).
    // Use client.request for header access.
    const res = await this.client.request({
      url: this.getMethodUrl('generateContent'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'json',
      body: JSON.stringify(wireReq),
      retryConfig: {
        retryDelay: 1000,
        retry: 3,
        noResponseRetries: 3,
        statusCodesToRetry: [
          [429, 429],
          [499, 499],
          [500, 599],
        ],
      },
    });

    const status = res.status;
    const headers = pickHeaders(res.headers ?? {});
    const data = res.data as { response?: unknown };
    return {
      status,
      headers,
      body: data.response ?? data,
    };
  }
}
