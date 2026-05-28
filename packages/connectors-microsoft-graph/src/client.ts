import type { JsonRecord } from "@access-kit/core";

import { DEFAULT_BASE_URL } from "./constants.js";

export interface MicrosoftGraphCollectionPage<T> {
  value: T[];
  nextLink?: string;
  deltaLink?: string;
  status?: number;
  retryAfterSeconds?: number;
  requestId?: string;
}

export interface MicrosoftGraphRecordResponse<T> {
  value?: T;
  status?: number;
  retryAfterSeconds?: number;
  requestId?: string;
}

export interface MicrosoftGraphCollectionRead<T> {
  values: T[];
  completed: boolean;
}

export interface MicrosoftGraphReadClient {
  list<T>(pathOrUrl: string, options?: { headers?: Record<string, string> }): Promise<MicrosoftGraphCollectionPage<T>>;
  get<T>(pathOrUrl: string, options?: { headers?: Record<string, string> }): Promise<MicrosoftGraphRecordResponse<T>>;
}

export interface FetchMicrosoftGraphClientOptions {
  accessToken?: string;
  tokenProvider?: () => Promise<string> | string;
  baseUrl?: string;
  fetch?: typeof fetch;
  allowedOrigins?: string[];
}

export class FetchMicrosoftGraphClient implements MicrosoftGraphReadClient {
  readonly #baseUrl: string;
  readonly #allowedOrigins: Set<string>;
  readonly #fetch: typeof fetch;
  readonly #tokenProvider: () => Promise<string> | string;

  constructor(options: FetchMicrosoftGraphClientOptions) {
    const tokenProvider = options.tokenProvider ?? (() => options.accessToken ?? "");
    this.#tokenProvider = tokenProvider;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#allowedOrigins = new Set([new URL(this.#baseUrl).origin, ...(options.allowedOrigins ?? [])]);
    this.#fetch = options.fetch ?? fetch;
  }

  async list<T>(pathOrUrl: string, options: { headers?: Record<string, string> } = {}): Promise<MicrosoftGraphCollectionPage<T>> {
    const accessToken = await this.#tokenProvider();
    if (!accessToken) {
      return {
        value: [],
        status: 401
      };
    }

    const url = this.#toUrl(pathOrUrl);
    const response = await this.#fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers
      }
    });
    const body = await readResponseJson(response);
    const value = Array.isArray(body.value) ? body.value as T[] : [];

    return {
      value,
      nextLink: readString(body["@odata.nextLink"]),
      deltaLink: readString(body["@odata.deltaLink"]),
      status: response.status,
      retryAfterSeconds: readRetryAfter(response),
      requestId: response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? undefined
    };
  }

  async get<T>(pathOrUrl: string, options: { headers?: Record<string, string> } = {}): Promise<MicrosoftGraphRecordResponse<T>> {
    const accessToken = await this.#tokenProvider();
    if (!accessToken) {
      return {
        status: 401
      };
    }

    const url = this.#toUrl(pathOrUrl);
    const response = await this.#fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers
      }
    });
    const body = await readResponseJson(response);

    return {
      value: isJsonRecord(body) ? body as T : undefined,
      status: response.status,
      retryAfterSeconds: readRetryAfter(response),
      requestId: response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? undefined
    };
  }

  #toUrl(pathOrUrl: string): string {
    const url = /^https:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : new URL(`${this.#baseUrl}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`);

    if (!this.#allowedOrigins.has(url.origin)) {
      throw new Error(`Microsoft Graph pagination URL origin ${url.origin} is not in the approved Graph endpoint allowlist.`);
    }

    return url.toString();
  }
}

export async function readResponseJson(response: Response): Promise<JsonRecord> {
  try {
    const body: unknown = await response.json();
    return isJsonRecord(body) ? body : {};
  } catch {
    return {};
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readRetryAfter(response: Response): number | undefined {
  const retryAfterHeader = response.headers.get("retry-after");
  if (!retryAfterHeader) {
    return undefined;
  }

  const retryAfter = Number(retryAfterHeader);
  return Number.isFinite(retryAfter) ? retryAfter : undefined;
}

const MAX_RETRY_AFTER_MILLISECONDS = 60_000;

export function retryAfterSecondsToMilliseconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.ceil(value * 1000), MAX_RETRY_AFTER_MILLISECONDS)
    : 0;
}

export async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
