export interface PostgresPersistenceConfig {
  databaseUrl: string;
  tenantBoundary: string;
  auditSigningKeyMaterial: string;
}

const minimumSigningKeyMaterialLength = 32;

export function assertPostgresDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("REBAC_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error('REBAC_DATABASE_URL must use the "postgres://" or "postgresql://" scheme.');
  }
}

export function assertPostgresTenantBoundary(tenantBoundary: string): void {
  if (tenantBoundary.trim().length === 0) {
    throw new Error("REBAC_DATABASE_TENANT_BOUNDARY is required when REBAC_DATABASE_URL is set.");
  }
}

export function assertPostgresAuditSigningKeyMaterial(signingKeyMaterial: string): void {
  if (signingKeyMaterial.length < minimumSigningKeyMaterialLength) {
    throw new Error(
      `REBAC_DATABASE_AUDIT_SIGNING_KEY must be at least ${minimumSigningKeyMaterialLength} characters when REBAC_DATABASE_URL is set.`
    );
  }
}

export function assertPostgresPersistenceConfig(config: PostgresPersistenceConfig): void {
  assertPostgresDatabaseUrl(config.databaseUrl);
  assertPostgresTenantBoundary(config.tenantBoundary);
  assertPostgresAuditSigningKeyMaterial(config.auditSigningKeyMaterial);
}
