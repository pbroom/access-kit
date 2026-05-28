import { createHash } from "node:crypto";

export function createIdempotencyKey(method: string, path: string, body: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ method, path, body }))
    .digest("hex")
    .slice(0, 32);
  return `idem:cli:${method.toLowerCase()}:${hash}`;
}

export function relationshipId(subjectId: string, relation: string, objectId: string): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ objectId, relation, subjectId }))
    .digest("hex")
    .slice(0, 32);
  return `relationship:cli:${hash}`;
}

export function normalizeEmergencyRevokeForIdempotency(
  requestBody: Record<string, unknown> & { approval: Record<string, unknown> }
): Record<string, unknown> {
  return {
    ...requestBody,
    approval: {
      ...requestBody.approval,
      approvedAt: "cli-generated"
    }
  };
}
