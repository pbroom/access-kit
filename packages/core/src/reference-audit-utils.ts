import type { AuditIntegrityFinding, CanonicalId, JsonRecord } from "./domain.js";
import type { ReferenceRepositoryBackupMetadata } from "./reference-repositories.js";
import { isSecretMaterialSensitiveKey } from "./secret-material-heuristics.js";
import { stableHash } from "./repository-envelopes.js";
import type { ReferenceAuditStoreBackup } from "./reference-audit-models.js";

export function assertTenantBoundary(tenantBoundary: string): void {
  if (tenantBoundary.length === 0) {
    throw new Error("Reference audit adapters require a tenant boundary.");
  }
}

export function assertOptionalTenantBoundary(payload: JsonRecord, tenantBoundary: string, label: string): void {
  const payloadTenantBoundary = payload.tenantBoundary;

  if (payloadTenantBoundary !== undefined && payloadTenantBoundary !== tenantBoundary) {
    throw new Error(`${label} includes tenantBoundary ${String(payloadTenantBoundary)} outside ${tenantBoundary}.`);
  }
}

export function assertNoSecretMaterial(value: unknown, path: string): void {
  const findings = secretMaterialFindings(value, path);

  if (findings.length > 0) {
    throw new Error(`${findings[0]?.message ?? "Secret material must be redacted before production audit persistence."}`);
  }
}

export function secretMaterialFindings(value: unknown, path: string): AuditIntegrityFinding[] {
  if (typeof value === "string") {
    return isSensitiveString(value)
      ? [
          {
            code: "SECRET_MATERIAL_NOT_REDACTED",
            message: `${path} contains secret-looking material and must be redacted before production audit persistence.`,
            severity: "critical",
            actual: path
          }
        ]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => secretMaterialFindings(entry, `${path}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const nextPath = `${path}.${key}`;
    const findings: AuditIntegrityFinding[] = [];

    if (isSecretMaterialSensitiveKey(key)) {
      findings.push({
        code: "SECRET_MATERIAL_NOT_REDACTED",
        message: `${nextPath} contains secret material and must be redacted before production audit persistence.`,
        severity: "critical",
        actual: nextPath
      });
    }

    return [...findings, ...secretMaterialFindings(entry, nextPath)];
  });
}

export function assertNoIntegrityFindings(findings: AuditIntegrityFinding[], prefix: string): void {
  if (findings.length > 0) {
    throw new Error(`${prefix}: ${findings[0]?.message ?? "unknown finding"}`);
  }
}

export function finding(
  code: string,
  message: string,
  eventId?: CanonicalId,
  expected?: string,
  actual?: string
): AuditIntegrityFinding {
  return {
    code,
    message,
    severity: "critical",
    eventId,
    expected,
    actual
  };
}

export function withRecordHash<T extends { recordHash: string }>(record: T): T {
  return {
    ...record,
    recordHash: hashRecord(record)
  };
}

export function hashRecord(record: { recordHash?: string }): string {
  const withoutHash = { ...record };
  delete withoutHash.recordHash;
  return hashReference(withoutHash);
}

export function withBackupHash(backup: ReferenceAuditStoreBackup): ReferenceAuditStoreBackup {
  return {
    ...backup,
    backupHash: hashBackup(backup)
  };
}

export function hashBackup(backup: ReferenceAuditStoreBackup): string {
  return hashReference({
    version: backup.version,
    id: backup.id,
    tenantBoundary: backup.tenantBoundary,
    createdAt: backup.createdAt,
    auditRecords: backup.auditRecords,
    evidenceRecords: backup.evidenceRecords,
    signedWindows: backup.signedWindows,
    siemDeliveries: backup.siemDeliveries,
    backupMetadata: backup.backupMetadata
  });
}

export function hashReference(value: unknown): string {
  return `sha256:${stableHash(value)}`;
}

export function createBackupMetadata(metadata: Omit<ReferenceRepositoryBackupMetadata, "version">): ReferenceRepositoryBackupMetadata {
  return {
    ...metadata,
    version: "production-repository-backup:v1"
  };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

function isSensitiveString(value: string): boolean {
  return /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Basic\s+[A-Za-z0-9+/=]{12,})\b/i.test(value)
    || /(?:^|[\s?&{,;"'])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|api[_-]?token|auth[_-]?token|authorization|bearer[_-]?token|client[_-]?(?:key|secret)|credential|password|secret|session[_-]?token|token|x[_-]?api[_-]?key)\b["']?\s*[:=]/i.test(value)
    || /\b(?:sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/i.test(value)
    || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value)
    || /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/.test(value);
}
