import {
  assertAdminAuthorizationDescriptorSafe,
  createLocalBearerTokenAdminAuthorizationDescriptor,
  type AdminAuthorizationDescriptor
} from "@access-kit/core";

import { parseApiKeyEntry } from "./api-auth.js";

export interface RebacApiRuntimeConfig {
  host: string;
  port: number;
  actor: string;
  apiKeys: string[];
  adminAuthorization: AdminAuthorizationDescriptor;
  statePath?: string;
  evidenceRoot?: string;
}

const maxApiKeyBytes = 4096;
const adminAuthenticationModes = ["local_bearer_token", "idp_gateway", "mtls_gateway"] as const;
const adminIngressModes = ["none", "identity_aware_gateway", "mtls_gateway"] as const;
const adminSecretsManagers = [
  "local_env",
  "external_secret_manager",
  "aws_secrets_manager",
  "azure_key_vault",
  "gcp_secret_manager",
  "hashicorp_vault"
] as const;

export function readRebacApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RebacApiRuntimeConfig {
  const host = readHost(env.REBAC_API_HOST);
  const apiKeys = readList(env.REBAC_API_KEYS);
  const adminAuthorization = readAdminAuthorizationDescriptor(env);

  assertSafeAuthenticationConfig(host, apiKeys);
  assertAdminAuthorizationDescriptorSafe(adminAuthorization);

  return {
    host,
    port: readPort(env.REBAC_API_PORT),
    actor: env.REBAC_API_ACTOR ?? "service:api",
    apiKeys,
    adminAuthorization,
    statePath: readOptionalPath(env.REBAC_STATE_PATH),
    evidenceRoot: readOptionalPath(env.REBAC_EVIDENCE_ROOT)
  };
}

function readHost(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "127.0.0.1";
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

function readList(value: string | undefined): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

  if (items.some((item) => Buffer.byteLength(parseApiKeyEntry(item).token, "utf8") > maxApiKeyBytes)) {
    throw new Error("REBAC_API_KEYS entries must be 4096 bytes or less.");
  }

  return [...new Set(items)];
}

function readAdminAuthorizationDescriptor(env: NodeJS.ProcessEnv): AdminAuthorizationDescriptor {
  const mode = readEnum(env.REBAC_ADMIN_AUTH_MODE, adminAuthenticationModes, "REBAC_ADMIN_AUTH_MODE") ?? "local_bearer_token";
  const evidenceRefs = readList(env.REBAC_ADMIN_EVIDENCE_REFS);

  if (mode === "local_bearer_token") {
    return evidenceRefs.length > 0
      ? createLocalBearerTokenAdminAuthorizationDescriptor(evidenceRefs)
      : createLocalBearerTokenAdminAuthorizationDescriptor();
  }

  const ingressMode = readEnum(env.REBAC_ADMIN_INGRESS_MODE, adminIngressModes, "REBAC_ADMIN_INGRESS_MODE")
    ?? (mode === "mtls_gateway" ? "mtls_gateway" : "identity_aware_gateway");
  const secretManager = readEnum(env.REBAC_ADMIN_SECRETS_MANAGER, adminSecretsManagers, "REBAC_ADMIN_SECRETS_MANAGER")
    ?? "local_env";

  return {
    version: "admin-authorization:v1",
    authentication: {
      mode,
      provider: readOptionalText(env.REBAC_ADMIN_AUTH_PROVIDER),
      issuer: readOptionalPath(env.REBAC_ADMIN_AUTH_ISSUER),
      subjectClaim: readOptionalText(env.REBAC_ADMIN_AUTH_SUBJECT_CLAIM, "sub"),
      groupsClaim: readOptionalPath(env.REBAC_ADMIN_AUTH_GROUPS_CLAIM),
      mfaRequired: readBoolean(env.REBAC_ADMIN_MFA_REQUIRED, "REBAC_ADMIN_MFA_REQUIRED", false),
      sessionTtlMinutes: readNonNegativeNumber(env.REBAC_ADMIN_SESSION_TTL_MINUTES, "REBAC_ADMIN_SESSION_TTL_MINUTES", 0),
      revocationSlaMinutes: readNonNegativeNumber(env.REBAC_ADMIN_REVOCATION_SLA_MINUTES, "REBAC_ADMIN_REVOCATION_SLA_MINUTES", 0),
      evidenceRefs: [...evidenceRefs]
    },
    ingress: {
      mode: ingressMode,
      mtlsRequired: readBoolean(env.REBAC_ADMIN_MTLS_REQUIRED, "REBAC_ADMIN_MTLS_REQUIRED", mode === "mtls_gateway"),
      trustedIdentityHeaders: readList(env.REBAC_ADMIN_TRUSTED_IDENTITY_HEADERS),
      certificateAuthorityRef: readOptionalPath(env.REBAC_ADMIN_CERTIFICATE_AUTHORITY_REF),
      evidenceRefs: [...evidenceRefs]
    },
    adminRebac: {
      policyId: readOptionalPath(env.REBAC_ADMIN_REBAC_POLICY_ID),
      separateFromApplicationAuthorization: readBoolean(
        env.REBAC_ADMIN_REBAC_SEPARATE_FROM_APP_AUTHZ,
        "REBAC_ADMIN_REBAC_SEPARATE_FROM_APP_AUTHZ",
        false
      ),
      leastPrivilegeRoles: readList(env.REBAC_ADMIN_REBAC_ROLES),
      roleBindings: readList(env.REBAC_ADMIN_REBAC_BINDINGS),
      revocationSlaMinutes: readNonNegativeNumber(env.REBAC_ADMIN_REBAC_REVOCATION_SLA_MINUTES, "REBAC_ADMIN_REBAC_REVOCATION_SLA_MINUTES", 0),
      evidenceRefs: [...evidenceRefs]
    },
    secrets: {
      manager: secretManager,
      secretRefs: readList(env.REBAC_ADMIN_SECRET_REFS),
      rotationDays: readNonNegativeNumber(env.REBAC_ADMIN_SECRET_ROTATION_DAYS, "REBAC_ADMIN_SECRET_ROTATION_DAYS", 0),
      noPlaintextEnvironmentSecrets: readBoolean(
        env.REBAC_ADMIN_NO_PLAINTEXT_ENV_SECRETS,
        "REBAC_ADMIN_NO_PLAINTEXT_ENV_SECRETS",
        false
      ),
      evidenceRefs: [...evidenceRefs]
    },
    emergency: {
      breakGlassApprovalRequired: readBoolean(
        env.REBAC_ADMIN_BREAK_GLASS_APPROVAL_REQUIRED,
        "REBAC_ADMIN_BREAK_GLASS_APPROVAL_REQUIRED",
        false
      ),
      breakGlassApproverRoles: readList(env.REBAC_ADMIN_BREAK_GLASS_APPROVER_ROLES),
      temporaryElevationMaxMinutes: readNonNegativeNumber(
        env.REBAC_ADMIN_TEMPORARY_ELEVATION_MAX_MINUTES,
        "REBAC_ADMIN_TEMPORARY_ELEVATION_MAX_MINUTES",
        0
      ),
      incidentModeNotificationTargets: readList(env.REBAC_ADMIN_INCIDENT_NOTIFICATION_TARGETS),
      postActionReviewRequired: readBoolean(
        env.REBAC_ADMIN_POST_ACTION_REVIEW_REQUIRED,
        "REBAC_ADMIN_POST_ACTION_REVIEW_REQUIRED",
        false
      ),
      evidenceRefs: [...evidenceRefs]
    },
    audit: {
      auditEventTypes: readList(env.REBAC_ADMIN_AUDIT_EVENT_TYPES),
      evidenceExportRequired: readBoolean(env.REBAC_ADMIN_EVIDENCE_EXPORT_REQUIRED, "REBAC_ADMIN_EVIDENCE_EXPORT_REQUIRED", false),
      evidenceRefs: [...evidenceRefs]
    }
  };
}

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string
): T | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if ((allowed as readonly string[]).includes(trimmed)) {
    return trimmed as T;
  }

  throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
}

function readOptionalText(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function readBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return fallback;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function readNonNegativeNumber(value: string | undefined, name: string, fallback: number): number {
  const trimmed = value?.trim();

  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function assertSafeAuthenticationConfig(host: string, apiKeys: readonly string[]): void {
  if (apiKeys.length > 0 || isLoopbackHost(host)) {
    return;
  }

  throw new Error("REBAC_API_KEYS must be set when REBAC_API_HOST is not a loopback host.");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}
