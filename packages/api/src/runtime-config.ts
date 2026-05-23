export interface RebacApiRuntimeConfig {
  host: string;
  port: number;
  actor: string;
  statePath?: string;
  evidenceRoot?: string;
}

export function readRebacApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RebacApiRuntimeConfig {
  return {
    host: env.REBAC_API_HOST ?? "127.0.0.1",
    port: readPort(env.REBAC_API_PORT),
    actor: env.REBAC_API_ACTOR ?? "service:api",
    statePath: readOptionalPath(env.REBAC_STATE_PATH),
    evidenceRoot: readOptionalPath(env.REBAC_EVIDENCE_ROOT)
  };
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
