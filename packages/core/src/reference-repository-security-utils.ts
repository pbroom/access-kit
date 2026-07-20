import type { EnforcementReadinessReport, JsonRecord } from "./domain.js";
import { isSecretMaterialSensitiveKey } from "./secret-material-heuristics.js";

export function assertReportTenantBoundary(report: EnforcementReadinessReport, tenantBoundary: string): void {
  if (report.tenantBoundary !== tenantBoundary) {
    throw new Error(`Enforcement readiness report ${report.id} crosses the configured tenant boundary.`);
  }
}

export function assertEvidenceTenantBoundary(evidence: JsonRecord, tenantBoundary: string, label: string): void {
  if (evidence.tenantBoundary !== tenantBoundary) {
    throw new Error(`${label} must include matching evidence.tenantBoundary for production persistence.`);
  }
}

export function assertNoSecretMaterial(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretMaterial(entry, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (isSecretMaterialSensitiveKey(key)) {
      throw new Error(`${path}.${key} contains secret material and cannot be persisted by a production adapter.`);
    }
    assertNoSecretMaterial(entry, `${path}.${key}`);
  }
}

export function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
