import { createHash } from "node:crypto";
import type { AuditEvent, AuditIntegrityFinding, AuditIntegrityReport, CanonicalId, JsonRecord } from "./domain.js";

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
      eventId: `evt:${sha256({ ...input, occurredAt, previousEventHash }).slice(0, 24)}`,
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

export function auditPayloadHash(payload: JsonRecord): string {
  return hashReference(payload);
}

export function verifyAuditChain(events: AuditEvent[], verifiedAt: string): AuditIntegrityReport {
  const findings: AuditIntegrityFinding[] = [];

  events.forEach((event, index) => {
    const expectedPayloadHash = auditPayloadHash(event.payload);
    if (event.payloadHash !== expectedPayloadHash) {
      findings.push({
        code: "PAYLOAD_HASH_MISMATCH",
        message: "Audit event payload hash does not match the current payload.",
        severity: "critical",
        eventId: event.eventId,
        expected: expectedPayloadHash,
        actual: event.payloadHash
      });
    }

    const previousEvent = events[index - 1];
    const expectedPreviousHash = previousEvent ? auditEventHash(previousEvent) : undefined;
    if (event.previousEventHash !== expectedPreviousHash) {
      findings.push({
        code: "PREVIOUS_EVENT_HASH_MISMATCH",
        message: "Audit event previousEventHash does not match the prior event in append-only order.",
        severity: "critical",
        eventId: event.eventId,
        expected: expectedPreviousHash ?? "<none>",
        actual: event.previousEventHash ?? "<none>"
      });
    }
  });

  const firstEvent = events.at(0);
  const lastEvent = events.at(-1);

  return {
    status: findings.length === 0 ? "verified" : "failed",
    eventCount: events.length,
    verifiedAt,
    firstEventId: firstEvent?.eventId,
    lastEventId: lastEvent?.eventId,
    firstEventHash: firstEvent ? auditEventHash(firstEvent) : undefined,
    lastEventHash: lastEvent ? auditEventHash(lastEvent) : undefined,
    findings,
    version: "audit-integrity:v1"
  };
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
