export interface RebacApiRuntimeConfig {
  host: string;
  port: number;
  actor: string;
  apiKeys: string[];
  statePath?: string;
  evidenceRoot?: string;
}

const maxApiKeyBytes = 4096;

export function readRebacApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RebacApiRuntimeConfig {
  const host = readHost(env.REBAC_API_HOST);
  const apiKeys = readList(env.REBAC_API_KEYS);

  assertSafeAuthenticationConfig(host, apiKeys);

  return {
    host,
    port: readPort(env.REBAC_API_PORT),
    actor: env.REBAC_API_ACTOR ?? "service:api",
    apiKeys,
    statePath: readOptionalPath(env.REBAC_STATE_PATH),
    evidenceRoot: readOptionalPath(env.REBAC_EVIDENCE_ROOT)
  };
}

function readHost(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "127.0.0.1";
}

function readPort(value: string | undefined): number {
  const trimmed = value?.trim();

  if (!trimmed) {
    return 3000;
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("REBAC_API_PORT must be an integer between 1 and 65535.");
  }

  return parsed;
}

function readOptionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readList(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

  if (items.some((item) => Buffer.byteLength(item, "utf8") > maxApiKeyBytes)) {
    throw new Error("REBAC_API_KEYS entries must be 4096 bytes or less.");
  }

  return [...new Set(items)];
}

function assertSafeAuthenticationConfig(host: string, apiKeys: readonly string[]): void {
  if (apiKeys.length > 0 || isLoopbackHost(host)) {
    return;
  }

  throw new Error("REBAC_API_KEYS must be set when REBAC_API_HOST is not a loopback host.");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}
