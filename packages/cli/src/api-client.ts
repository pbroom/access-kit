import { createIdempotencyKey } from "./idempotency.js";
import type { CliRuntimeOptions } from "./runtime-options.js";

interface RequestOptions {
  idempotencyBody?: unknown;
}

export class ApiClient {
  constructor(
    readonly options: CliRuntimeOptions,
    readonly fetchImpl: typeof fetch
  ) {}

  get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  post(path: string, body: unknown, options?: RequestOptions): Promise<unknown> {
    return this.request("POST", path, body, options);
  }

  put(path: string, body: unknown, options?: RequestOptions): Promise<unknown> {
    return this.request("PUT", path, body, options);
  }

  delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  async request(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<unknown> {
    const idempotencyKey = createIdempotencyKey(method, path, options.idempotencyBody ?? body);

    if (this.options.preview) {
      return buildRequestPreview(this.options, method, path, body, idempotencyKey);
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    };

    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    const response = await this.fetchImpl(`${this.options.apiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = parseResponseBody(await response.text());

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${JSON.stringify(payload)}`);
    }

    return payload;
  }
}

function buildRequestPreview(
  options: CliRuntimeOptions,
  method: string,
  path: string,
  body: unknown,
  idempotencyKey: string
): Record<string, unknown> {
  const preview: Record<string, unknown> = {
    mode: "preview",
    apiUrl: options.apiUrl,
    method,
    path,
    idempotencyKey
  };

  if (body !== undefined) {
    preview.body = body;
  }

  if (options.diff) {
    preview.diff = buildRequestDiff(method, path, body);
  }

  return preview;
}

function buildRequestDiff(method: string, path: string, body: unknown): string[] {
  const lines = [`+ ${method} ${path}`];

  if (body !== undefined) {
    lines.push(...JSON.stringify(body, null, 2).split("\n").map((line) => `+ ${line}`));
  }

  return lines;
}

function parseResponseBody(body: string): unknown {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
