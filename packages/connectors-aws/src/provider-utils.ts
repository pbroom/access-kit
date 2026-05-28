import { sha256, type DiscoveryRunWarning, type Resource } from "@access-kit/core";

const REDACTION_HASH_LENGTH = 16;

export const MILLISECONDS_PER_MINUTE = 60_000;

export function redactValue(value: string, length = REDACTION_HASH_LENGTH): string {
  return sha256({ value }).slice(0, length);
}

export function rawKeyEntry(key: string | undefined, resource: Resource): Array<[string, Resource]> {
  return key ? [[key, resource]] : [];
}

export function safePermissionLabel(value: string): string {
  return value.replaceAll(/[^a-z0-9_.:,-]+/gi, "-").replaceAll(/^-|-$/g, "") || "unknown";
}

export function positiveNumberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function compactTimestamp(value: string): string {
  return value.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();
}

export function warningSeverityRank(severity: DiscoveryRunWarning["severity"]): number {
  return severity === "warning" ? 1 : 0;
}
