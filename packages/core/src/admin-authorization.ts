import type { CanonicalId, IsoDateTime, JsonRecord, ValidationCheckStatus } from "./domain.js";

export type AdminAuthenticationMode = "local_bearer_token" | "idp_gateway" | "mtls_gateway";
export type AdminIngressMode = "none" | "identity_aware_gateway" | "mtls_gateway";
export type AdminSecretsManagerKind =
  | "local_env"
  | "external_secret_manager"
  | "aws_secrets_manager"
  | "azure_key_vault"
  | "gcp_secret_manager"
  | "hashicorp_vault";
export type AdminAuthorizationReadinessStatus = "ready" | "blocked";

export interface AdminAuthenticationControl {
  mode: AdminAuthenticationMode;
  provider: string;
  issuer?: string;
  subjectClaim: string;
  groupsClaim?: string;
  mfaRequired: boolean;
  sessionTtlMinutes: number;
  revocationSlaMinutes: number;
  evidenceRefs: string[];
}

export interface AdminIngressControl {
  mode: AdminIngressMode;
  mtlsRequired: boolean;
  trustedIdentityHeaders: string[];
  certificateAuthorityRef?: string;
  evidenceRefs: string[];
}

export interface AdminRebacControl {
  policyId?: CanonicalId;
  separateFromApplicationAuthorization: boolean;
  leastPrivilegeRoles: string[];
  roleBindings: string[];
  revocationSlaMinutes: number;
  evidenceRefs: string[];
}

export interface AdminSecretsControl {
  manager: AdminSecretsManagerKind;
  secretRefs: string[];
  rotationDays: number;
  noPlaintextEnvironmentSecrets: boolean;
  evidenceRefs: string[];
}

export interface AdminEmergencyControl {
  breakGlassApprovalRequired: boolean;
  breakGlassApproverRoles: string[];
  temporaryElevationMaxMinutes: number;
  incidentModeNotificationTargets: string[];
  postActionReviewRequired: boolean;
  evidenceRefs: string[];
}

export interface AdminAuditControl {
  auditEventTypes: string[];
  evidenceExportRequired: boolean;
  evidenceRefs: string[];
}

export interface AdminAuthorizationDescriptor {
  version: "admin-authorization:v1";
  authentication: AdminAuthenticationControl;
  ingress: AdminIngressControl;
  adminRebac: AdminRebacControl;
  secrets: AdminSecretsControl;
  emergency: AdminEmergencyControl;
  audit: AdminAuditControl;
}

export interface AdminAuthorizationReadinessCheck {
  name: string;
  status: ValidationCheckStatus;
  message: string;
  evidence: JsonRecord;
}

export interface AdminAuthorizationReadinessReport {
  id: CanonicalId;
  status: AdminAuthorizationReadinessStatus;
  checkedAt: IsoDateTime;
  descriptorVersion: AdminAuthorizationDescriptor["version"];
  authenticationMode: AdminAuthenticationMode;
  checks: AdminAuthorizationReadinessCheck[];
  version: "admin-authorization-readiness:v1";
}

export function createLocalBearerTokenAdminAuthorizationDescriptor(
  evidenceRefs: string[] = ["docs/security-model.md#authentication"]
): AdminAuthorizationDescriptor {
  return {
    version: "admin-authorization:v1",
    authentication: {
      mode: "local_bearer_token",
      provider: "local-api-key-proof-point",
      subjectClaim: "bearer-token",
      mfaRequired: false,
      sessionTtlMinutes: 0,
      revocationSlaMinutes: 1440,
      evidenceRefs: [...evidenceRefs]
    },
    ingress: {
      mode: "none",
      mtlsRequired: false,
      trustedIdentityHeaders: [],
      evidenceRefs: [...evidenceRefs]
    },
    adminRebac: {
      separateFromApplicationAuthorization: false,
      leastPrivilegeRoles: [],
      roleBindings: [],
      revocationSlaMinutes: 1440,
      evidenceRefs: [...evidenceRefs]
    },
    secrets: {
      manager: "local_env",
      secretRefs: [],
      rotationDays: 365,
      noPlaintextEnvironmentSecrets: false,
      evidenceRefs: [...evidenceRefs]
    },
    emergency: {
      breakGlassApprovalRequired: false,
      breakGlassApproverRoles: [],
      temporaryElevationMaxMinutes: 1440,
      incidentModeNotificationTargets: [],
      postActionReviewRequired: false,
      evidenceRefs: [...evidenceRefs]
    },
    audit: {
      auditEventTypes: ["api.authentication_failed"],
      evidenceExportRequired: false,
      evidenceRefs: [...evidenceRefs]
    }
  };
}

export function assessAdminAuthorizationReadiness(
  descriptor: AdminAuthorizationDescriptor,
  checkedAt: IsoDateTime
): AdminAuthorizationReadinessReport {
  assertAdminAuthorizationDescriptorSafe(descriptor);

  const checks = [
    identityProviderCheck(descriptor),
    gatewayOrMtlsCheck(descriptor),
    adminRebacCheck(descriptor),
    secretsManagerCheck(descriptor),
    breakGlassApprovalCheck(descriptor),
    incidentNotificationCheck(descriptor),
    postActionReviewCheck(descriptor)
  ];

  return {
    id: `admin-authorization:${compactTimestamp(checkedAt)}`,
    status: checks.some((check) => check.status === "fail") ? "blocked" : "ready",
    checkedAt,
    descriptorVersion: descriptor.version,
    authenticationMode: descriptor.authentication.mode,
    checks,
    version: "admin-authorization-readiness:v1"
  };
}

export function assertAdminAuthorizationDescriptorSafe(descriptor: AdminAuthorizationDescriptor): void {
  inspectForSecretMaterial(descriptor, "adminAuthorization");
}

function identityProviderCheck(descriptor: AdminAuthorizationDescriptor): AdminAuthorizationReadinessCheck {
  const authentication = descriptor.authentication;
  const ready = authentication.mode !== "local_bearer_token"
    && hasText(authentication.provider)
    && hasText(authentication.issuer)
    && hasText(authentication.subjectClaim)
    && authentication.mfaRequired
    && authentication.sessionTtlMinutes > 0
    && authentication.sessionTtlMinutes <= 480
    && authentication.revocationSlaMinutes > 0
    && authentication.revocationSlaMinutes <= 60
    && authentication.evidenceRefs.length > 0;

  return check(
    "production_identity_provider",
    ready,
    "Admin authentication is delegated to an approved identity provider with MFA and revocation evidence.",
    "Local bearer-token proof points are not production admin authentication; configure an approved IdP-backed boundary with MFA, bounded sessions, revocation SLA, and retained evidence.",
    {
      mode: authentication.mode,
      provider: authentication.provider,
      issuerConfigured: hasText(authentication.issuer),
      subjectClaim: authentication.subjectClaim,
      groupsClaimConfigured: hasText(authentication.groupsClaim),
      mfaRequired: authentication.mfaRequired,
      sessionTtlMinutes: authentication.sessionTtlMinutes,
      revocationSlaMinutes: authentication.revocationSlaMinutes,
      evidenceRefCount: authentication.evidenceRefs.length
    }
  );
}

function gatewayOrMtlsCheck(descriptor: AdminAuthorizationDescriptor): AdminAuthorizationReadinessCheck {
  const ingress = descriptor.ingress;
  const ready = ingress.mode === "identity_aware_gateway"
    ? ingress.trustedIdentityHeaders.length > 0 && ingress.evidenceRefs.length > 0
    : ingress.mode === "mtls_gateway" && ingress.mtlsRequired && hasText(ingress.certificateAuthorityRef) && ingress.evidenceRefs.length > 0;

  return check(
    "gateway_or_mtls_boundary",
    ready,
    "Admin traffic is constrained by an identity-aware gateway or mTLS gateway before reaching the API.",
    "Production admin access must enter through an identity-aware gateway or mTLS gateway with retained boundary evidence.",
    {
      mode: ingress.mode,
      mtlsRequired: ingress.mtlsRequired,
      trustedIdentityHeaderCount: ingress.trustedIdentityHeaders.length,
      certificateAuthorityConfigured: hasText(ingress.certificateAuthorityRef),
      evidenceRefCount: ingress.evidenceRefs.length
    }
  );
}

function adminRebacCheck(descriptor: AdminAuthorizationDescriptor): AdminAuthorizationReadinessCheck {
  const adminRebac = descriptor.adminRebac;
  const ready = hasText(adminRebac.policyId)
    && adminRebac.separateFromApplicationAuthorization
    && adminRebac.leastPrivilegeRoles.length > 0
    && adminRebac.roleBindings.length > 0
    && adminRebac.revocationSlaMinutes > 0
    && adminRebac.revocationSlaMinutes <= 60
    && adminRebac.evidenceRefs.length > 0;

  return check(
    "internal_admin_rebac",
    ready,
    "Administrative authorization is governed by a separate least-privilege ReBAC policy.",
    "Define an internal admin ReBAC policy that is separate from application authorization, role-limited, revocable, and evidenced.",
    {
      policyConfigured: hasText(adminRebac.policyId),
      separateFromApplicationAuthorization: adminRebac.separateFromApplicationAuthorization,
      leastPrivilegeRoleCount: adminRebac.leastPrivilegeRoles.length,
      roleBindingCount: adminRebac.roleBindings.length,
      revocationSlaMinutes: adminRebac.revocationSlaMinutes,
      evidenceRefCount: adminRebac.evidenceRefs.length
    }
  );
}

function secretsManagerCheck(descriptor: AdminAuthorizationDescriptor): AdminAuthorizationReadinessCheck {
  const secrets = descriptor.secrets;
  const ready = secrets.manager !== "local_env"
    && secrets.secretRefs.length > 0
    && secrets.rotationDays > 0
    && secrets.rotationDays <= 90
    && secrets.noPlaintextEnvironmentSecrets
    && secrets.evidenceRefs.length > 0;

  return check(
    "secrets_manager_integration",
    ready,
    "Admin authentication and emergency credentials are referenced from an approved secrets manager with rotation evidence.",
    "Production admin controls must use an approved secrets manager, avoid plaintext environment secrets, and retain rotation evidence.",
    {
      manager: secrets.manager,
      secretRefCount: secrets.secretRefs.length,
      rotationDays: secrets.rotationDays,
      noPlaintextEnvironmentSecrets: secrets.noPlaintextEnvironmentSecrets,
      evidenceRefCount: secrets.evidenceRefs.length
    }
  );
}

function breakGlassApprovalCheck(descriptor: AdminAuthorizationDescriptor): AdminAuthorizationReadinessCheck {
  const emergency = descriptor.emergency;
  const ready = emergency.breakGlassApprovalRequired
    && emergency.breakGlassApproverRoles.length >= 2
    && emergency.temporaryElevationMaxMinutes > 0
    && emergency.temporaryElevationMaxMinutes <= 120
    && emergency.evidenceRefs.length > 0;

  return check(
    "break_glass_approval",
    ready,
    "Break-glass access requires multi-role approval, bounded elevation, and retained evidence.",
    "Break-glass admin access must require approval, short-lived elevation, and retained emergency evidence.",
    {
      approvalRequired: emergency.breakGlassApprovalRequired,
      approverRoleCount: emergency.breakGlassApproverRoles.length,
      temporaryElevationMaxMinutes: emergency.temporaryElevationMaxMinutes,
      evidenceRefCount: emergency.evidenceRefs.length
    }
  );
}

function incidentNotificationCheck(descriptor: AdminAuthorizationDescriptor): AdminAuthorizationReadinessCheck {
  const emergency = descriptor.emergency;
  const ready = emergency.incidentModeNotificationTargets.length > 0 && emergency.evidenceRefs.length > 0;

  return check(
    "incident_mode_notifications",
    ready,
    "Incident-mode and emergency admin actions notify retained operational channels.",
    "Incident-mode and emergency admin workflows must notify reviewed channels such as SIEM, paging, ticketing, or incident command.",
    {
      notificationTargetCount: emergency.incidentModeNotificationTargets.length,
      evidenceRefCount: emergency.evidenceRefs.length
    }
  );
}

function postActionReviewCheck(descriptor: AdminAuthorizationDescriptor): AdminAuthorizationReadinessCheck {
  const emergency = descriptor.emergency;
  const audit = descriptor.audit;
  const requiredEvents = ["admin.action", "admin.post_action_review"];
  const ready = emergency.postActionReviewRequired
    && audit.evidenceExportRequired
    && requiredEvents.every((eventType) => audit.auditEventTypes.includes(eventType))
    && audit.evidenceRefs.length > 0;

  return check(
    "post_action_review_evidence",
    ready,
    "Emergency and privileged admin actions require post-action review evidence and exportable audit events.",
    "Production admin workflows must retain post-action review evidence tied to admin action audit events.",
    {
      postActionReviewRequired: emergency.postActionReviewRequired,
      evidenceExportRequired: audit.evidenceExportRequired,
      auditEventTypes: audit.auditEventTypes,
      evidenceRefCount: audit.evidenceRefs.length
    }
  );
}

function check(
  name: string,
  ready: boolean,
  passMessage: string,
  failMessage: string,
  evidence: JsonRecord
): AdminAuthorizationReadinessCheck {
  return {
    name,
    status: ready ? "pass" : "fail",
    message: ready ? passMessage : failMessage,
    evidence
  };
}

function inspectForSecretMaterial(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (looksLikeSecretValue(value) && !isAllowedReference(value)) {
      throw new Error(`${path} contains secret material and must reference redacted external secret handles instead.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForSecretMaterial(item, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`;
    if (typeof item === "string" && isSecretKeyName(key) && !isAllowedReference(item)) {
      throw new Error(`${itemPath} contains secret material and must reference redacted external secret handles instead.`);
    }
    inspectForSecretMaterial(item, itemPath);
  }
}

function looksLikeSecretValue(value: string): boolean {
  return /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(value)
    || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/.test(value)
    || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value);
}

function isSecretKeyName(key: string): boolean {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
  return [
    "accesskey",
    "accesstoken",
    "apikey",
    "apisecret",
    "apitoken",
    "authorization",
    "authtoken",
    "bearertoken",
    "clientkey",
    "clientsecret",
    "cookie",
    "encryptionkey",
    "hmackey",
    "idtoken",
    "password",
    "privatekey",
    "refreshtoken",
    "secret",
    "sessiontoken",
    "signingkey",
    "token",
    "xapikey"
  ].includes(normalized);
}

function isAllowedReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "[redacted]"
    || trimmed === "redacted"
    || trimmed.startsWith("ref:")
    || trimmed.startsWith("secretref:")
    || trimmed.startsWith("vault:")
    || trimmed.startsWith("aws-secrets-manager:")
    || trimmed.startsWith("azure-key-vault:")
    || trimmed.startsWith("gcp-secret-manager:");
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function compactTimestamp(value: string): string {
  return value.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();
}
