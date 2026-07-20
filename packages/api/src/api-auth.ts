import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { recordAudit, type RebacLocalApp } from "./local-app.js";

export type AuthenticationStatus = "authenticated" | "missing" | "invalid";
export type AuthenticationFailureReason = Exclude<AuthenticationStatus, "authenticated">;

export interface AuthenticationFailureSample {
  sampledAtMs: number;
  suppressedCount: number;
}

export interface ParsedApiKey {
  raw: string;
  token: string;
  label?: string;
}

export interface AuthenticationResult {
  status: AuthenticationStatus;
  apiKeyLabel?: string;
}

const bearerScheme = "bearer ";
const maxAuthorizationHeaderBytes = 8192;
const maxBearerTokenBytes = 4096;
const authenticationFailureAuditSampleWindowMs = 60_000;

export function parseApiKeyEntry(entry: string): ParsedApiKey {
  const trimmed = entry.trim();
  const separatorIndex = trimmed.indexOf(":");

  if (separatorIndex <= 0) {
    return { raw: trimmed, token: trimmed };
  }

  const label = trimmed.slice(0, separatorIndex).trim();
  const token = trimmed.slice(separatorIndex + 1).trim();

  if (!label || !token) {
    return { raw: trimmed, token: trimmed };
  }

  return { raw: trimmed, token, label };
}

export function parseApiKeys(apiKeys: readonly string[] | undefined): ParsedApiKey[] {
  const parsed = (apiKeys ?? []).map(parseApiKeyEntry).filter((entry) => entry.token.length > 0);

  if (parsed.some((entry) => byteLength(entry.token) > maxBearerTokenBytes)) {
    throw new Error("API keys must be 4096 bytes or less.");
  }

  const unique: ParsedApiKey[] = [];
  const seenTokens = new Set<string>();

  for (const entry of parsed) {
    if (seenTokens.has(entry.token)) {
      continue;
    }

    seenTokens.add(entry.token);
    unique.push(entry);
  }

  return unique;
}

export function normalizeApiKeys(apiKeys: readonly string[] | undefined): string[] {
  const normalized = (apiKeys ?? []).map((apiKey) => apiKey.trim()).filter(Boolean);

  if (normalized.some((apiKey) => byteLength(apiKey) > maxBearerTokenBytes)) {
    throw new Error("API keys must be 4096 bytes or less.");
  }

  return [...new Set(normalized)];
}

export function resolveRequestAuditActor(configuredActor: string, apiKeyLabel?: string): string {
  return apiKeyLabel ? `api-key:${apiKeyLabel}` : configuredActor;
}

export function authenticateRequest(request: IncomingMessage, apiKeys: readonly ParsedApiKey[]): AuthenticationResult {
  if (apiKeys.length === 0) {
    return { status: "authenticated" };
  }

  const token = readBearerToken(request);

  if (!token) {
    return { status: hasBearerAuthorization(request) ? "invalid" : "missing" };
  }

  let authenticated = false;
  let apiKeyLabel: string | undefined;

  for (const apiKey of apiKeys) {
    // Scan every configured key to avoid leaking the matching key's position.
    const matches = constantTimeEqual(apiKey.token, token);
    if (matches && !authenticated) {
      authenticated = true;
      apiKeyLabel = apiKey.label;
    }
  }

  return authenticated ? { status: "authenticated", apiKeyLabel } : { status: "invalid" };
}

export function bearerChallenge(status: AuthenticationStatus): string {
  return status === "invalid"
    ? 'Bearer realm="rebac-control-plane", error="invalid_token"'
    : 'Bearer realm="rebac-control-plane"';
}

export function recordAuthenticationFailure(
  app: RebacLocalApp,
  request: IncomingMessage,
  url: URL,
  authentication: AuthenticationFailureReason,
  authenticationFailureSamples: Map<AuthenticationFailureReason, AuthenticationFailureSample>,
  authenticationFailureAuditScope: string
): void {
  const occurredAt = app.now();
  const occurredAtMs = timestampMs(occurredAt);
  const priorSample = authenticationFailureSamples.get(authentication);

  if (priorSample && occurredAtMs - priorSample.sampledAtMs < authenticationFailureAuditSampleWindowMs) {
    priorSample.suppressedCount += 1;
    return;
  }

  const suppressedSinceLastSample = priorSample?.suppressedCount ?? 0;
  authenticationFailureSamples.set(authentication, {
    sampledAtMs: occurredAtMs,
    suppressedCount: 0
  });

  recordAudit(app, {
    eventType: "api.authentication_failed",
    actor: "anonymous",
    correlationId: `corr:auth:${authentication}:${authenticationFailureAuditScope}:${sampleWindowStart(occurredAtMs)}:${sanitizeAuditPath(url.pathname)}`,
    payload: {
      method: request.method ?? "GET",
      path: url.pathname,
      reason: authentication === "invalid" ? "invalid_bearer_token" : "missing_bearer_token",
      sampled: true,
      sampleWindowMs: authenticationFailureAuditSampleWindowMs,
      suppressedSinceLastSample,
      tokenLogged: false
    }
  }, {
    occurredAt,
    persistState: false
  });
}

function readBearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || byteLength(authorization) > maxAuthorizationHeaderBytes) {
    return undefined;
  }

  const trimmed = authorization.trim();
  if (!trimmed.toLowerCase().startsWith(bearerScheme)) {
    return undefined;
  }

  const token = trimmed.slice(bearerScheme.length).trim();
  if (byteLength(token) > maxBearerTokenBytes) {
    return undefined;
  }

  return token ? token : undefined;
}

function hasBearerAuthorization(request: IncomingMessage): boolean {
  const authorization = request.headers.authorization;
  return typeof authorization === "string" && authorization.trim().toLowerCase().startsWith(bearerScheme);
}

function constantTimeEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  const expectedLength = expectedBytes.byteLength;
  const actualLength = actualBytes.byteLength;
  const expectedPadded = Buffer.alloc(maxBearerTokenBytes);
  const actualPadded = Buffer.alloc(maxBearerTokenBytes);
  expectedBytes.copy(expectedPadded);
  actualBytes.copy(actualPadded);

  return timingSafeEqual(expectedPadded, actualPadded)
    && expectedLength === actualLength
    && expectedLength <= maxBearerTokenBytes
    && actualLength <= maxBearerTokenBytes;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function timestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sampleWindowStart(timestamp: number): number {
  return Math.floor(timestamp / authenticationFailureAuditSampleWindowMs) * authenticationFailureAuditSampleWindowMs;
}

function sanitizeAuditPath(path: string): string {
  return path.replaceAll(/[^a-z0-9_:-]/gi, "_").toLowerCase();
}
