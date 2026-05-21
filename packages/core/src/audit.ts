import { createHash } from "node:crypto";
import type { AuditEvent, CanonicalId, JsonRecord } from "./domain.js";

export interface AuditEventInput {
  eventType: AuditEvent["eventType"];
  actor: CanonicalId;
  subjectId?: CanonicalId;
  resourceId?: CanonicalId;
  correlationId: CanonicalId;
  policyVersion?: string;
  relationshipVersion?: string;
  payload: JsonRecord;
}

export class AuditRecorder {
  readonly #events: AuditEvent[] = [];

  constructor(seedEvents: AuditEvent[] = []) {
    this.#events.push(...seedEvents);
  }

  record(input: AuditEventInput, occurredAt: string): AuditEvent {
    const previousEvent = this.#events.at(-1);
    const previousEventHash = previousEvent ? auditEventHash(previousEvent) : undefined;
    const payloadHash = hashReference(input.payload);
    const event: AuditEvent = {
      eventId: `evt:${sha256({ ...input, occurredAt }).slice(0, 24)}`,
      eventType: input.eventType,
      occurredAt,
      actor: input.actor,
      subjectId: input.subjectId,
      resourceId: input.resourceId,
      correlationId: input.correlationId,
      policyVersion: input.policyVersion,
      relationshipVersion: input.relationshipVersion,
      payloadHash,
      previousEventHash,
      payload: input.payload
    };

    this.#events.push(event);
    return event;
  }

  list(): AuditEvent[] {
    return [...this.#events];
  }
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function auditEventHash(event: AuditEvent): string {
  return hashReference(event);
}

function hashReference(value: unknown): string {
  return `sha256:${sha256(value)}`;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
