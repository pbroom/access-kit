import type { ConnectorAdapter, JsonRecord } from "@access-kit/core";
import type { RebacLocalApp } from "./runtime-app.js";

const appRecordSequences = new WeakMap<RebacLocalApp, Map<string, number>>();

export function asJsonRecord(value: object): JsonRecord {
  return value as unknown as JsonRecord;
}

export function compactTimestamp(timestamp: string): string {
  return timestamp.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();
}

export function nextAppRecordSequence(app: RebacLocalApp, key: string, existingCount: number): number {
  let sequences = appRecordSequences.get(app);

  if (!sequences) {
    sequences = new Map();
    appRecordSequences.set(app, sequences);
  }

  const sequence = Math.max(sequences.get(key) ?? 0, existingCount) + 1;
  sequences.set(key, sequence);
  return sequence;
}

export function getConnector(app: RebacLocalApp, connectorId: string): ConnectorAdapter {
  const connector = app.connectors.get(connectorId);

  if (!connector) {
    throw new Error(`Unknown connector: ${connectorId}`);
  }

  return connector;
}

export function getDefaultConnectorId(app: RebacLocalApp): string {
  const connectorId = app.connectors.keys().next().value;

  if (!connectorId) {
    throw new Error("No connectors are registered");
  }

  return connectorId;
}
