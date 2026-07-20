import { createHash } from "node:crypto";

export function stablePostgresHash(value: unknown): string {
  return createHash("sha256").update(stablePostgresStringify(value)).digest("hex");
}

export function stablePostgresStringify(value: unknown): string {
  return JSON.stringify(sortValueKeys(value));
}

function sortValueKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValueKeys);
  }

  if (value && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const sorted: Record<string, unknown> = {};

    for (const key of sortedKeys) {
      sorted[key] = sortValueKeys((value as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  return value;
}
