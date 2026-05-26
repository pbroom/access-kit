import { describe, expect, it } from "vitest";
import {
  assessAdminAuthorizationReadiness,
  assertAdminAuthorizationDescriptorSafe,
  createLocalBearerTokenAdminAuthorizationDescriptor,
  type AdminAuthorizationDescriptor
} from "../../packages/core/src/index.js";

const checkedAt = "2026-05-26T12:00:00.000Z";

describe("admin authorization readiness", () => {
  it("blocks local bearer-token proof points from production admin readiness", () => {
    const report = assessAdminAuthorizationReadiness(createLocalBearerTokenAdminAuthorizationDescriptor(), checkedAt);

    expect(report).toMatchObject({
      id: "admin-authorization:20260526t120000000z",
      status: "blocked",
      authenticationMode: "local_bearer_token",
      version: "admin-authorization-readiness:v1"
    });
    expect(report.checks.map((check) => check.status)).toEqual(["fail", "fail", "fail", "fail", "fail", "fail", "fail"]);
  });

  it("gives local bearer-token sections independent evidence refs", () => {
    const descriptor = createLocalBearerTokenAdminAuthorizationDescriptor(["docs/security-model.md#authentication"]);

    descriptor.authentication.evidenceRefs.push("evidence/admin-auth/idp.json");

    expect(descriptor.ingress.evidenceRefs).toEqual(["docs/security-model.md#authentication"]);
    expect(descriptor.adminRebac.evidenceRefs).toEqual(["docs/security-model.md#authentication"]);
  });

  it("passes a complete IdP gateway, admin ReBAC, secrets, emergency, and audit evidence descriptor", () => {
    const report = assessAdminAuthorizationReadiness(createProductionDescriptor(), checkedAt);

    expect(report).toMatchObject({
      status: "ready",
      authenticationMode: "idp_gateway",
      checks: [
        { name: "production_identity_provider", status: "pass" },
        { name: "gateway_or_mtls_boundary", status: "pass" },
        { name: "internal_admin_rebac", status: "pass" },
        { name: "secrets_manager_integration", status: "pass" },
        { name: "break_glass_approval", status: "pass" },
        { name: "incident_mode_notifications", status: "pass" },
        { name: "post_action_review_evidence", status: "pass" }
      ]
    });
  });

  it("supports an mTLS gateway as the production admin ingress option", () => {
    const descriptor = createProductionDescriptor({
      authentication: {
        mode: "mtls_gateway",
        provider: "piv-cac-gateway",
        issuer: "spiffe://access-kit/admin-ca"
      },
      ingress: {
        mode: "mtls_gateway",
        mtlsRequired: true,
        trustedIdentityHeaders: [],
        certificateAuthorityRef: "ref:admin-client-ca"
      }
    });

    expect(assessAdminAuthorizationReadiness(descriptor, checkedAt)).toMatchObject({
      status: "ready",
      authenticationMode: "mtls_gateway"
    });
  });

  it("blocks incomplete production descriptors instead of treating documentation as configured controls", () => {
    const descriptor = createProductionDescriptor({
      secrets: {
        manager: "local_env",
        secretRefs: [],
        rotationDays: 365,
        noPlaintextEnvironmentSecrets: false
      },
      emergency: {
        breakGlassApprovalRequired: true,
        breakGlassApproverRoles: ["Security engineer"],
        temporaryElevationMaxMinutes: 480,
        incidentModeNotificationTargets: [],
        postActionReviewRequired: false
      }
    });

    const report = assessAdminAuthorizationReadiness(descriptor, checkedAt);

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "secrets_manager_integration", status: "fail" }),
      expect.objectContaining({ name: "break_glass_approval", status: "fail" }),
      expect.objectContaining({ name: "incident_mode_notifications", status: "fail" }),
      expect.objectContaining({ name: "post_action_review_evidence", status: "fail" })
    ]));
  });

  it("rejects secret-looking descriptor material", () => {
    const descriptor = createProductionDescriptor({
      secrets: {
        secretRefs: ["Bearer live-admin-token"]
      }
    });

    expect(() => assessAdminAuthorizationReadiness(descriptor, checkedAt)).toThrow(
      "contains secret material and must reference redacted external secret handles"
    );
  });

  it("rejects common secret key-name variants even when values do not match a token pattern", () => {
    const descriptor = createProductionDescriptor({
      secrets: {
        secretRefs: ["ref:access-kit/admin-gateway/client-secret"]
      }
    });
    const descriptorWithExtension = descriptor as AdminAuthorizationDescriptor & {
      extensions: { bearerToken: string; api_secret: string };
    };
    descriptorWithExtension.extensions = {
      bearerToken: "plain-live-token",
      api_secret: "plain-live-secret"
    };

    expect(() => assertAdminAuthorizationDescriptorSafe(descriptorWithExtension)).toThrow(
      "contains secret material and must reference redacted external secret handles"
    );
  });

  it("allows non-secret operational token and secret suffixes", () => {
    const descriptor = createProductionDescriptor({
      secrets: {
        secretRefs: ["ref:access-kit/admin-gateway/client-secret"]
      }
    });
    const descriptorWithExtension = descriptor as AdminAuthorizationDescriptor & {
      extensions: {
        csrf_token: string;
        next_token: string;
        pagination_token: string;
        scope_secret: string;
      };
    };
    descriptorWithExtension.extensions = {
      csrf_token: "csrf-state",
      next_token: "next-page",
      pagination_token: "page-cursor",
      scope_secret: "read:users"
    };

    expect(() => assertAdminAuthorizationDescriptorSafe(descriptorWithExtension)).not.toThrow();
  });
});

function createProductionDescriptor(
  overrides: DescriptorOverrides = {}
): AdminAuthorizationDescriptor {
  return mergeDescriptor({
    version: "admin-authorization:v1",
    authentication: {
      mode: "idp_gateway",
      provider: "enterprise-idp",
      issuer: "https://idp.example.test/tenant",
      subjectClaim: "sub",
      groupsClaim: "groups",
      mfaRequired: true,
      sessionTtlMinutes: 60,
      revocationSlaMinutes: 15,
      evidenceRefs: ["evidence/admin-auth/idp-configuration.json"]
    },
    ingress: {
      mode: "identity_aware_gateway",
      mtlsRequired: false,
      trustedIdentityHeaders: ["x-access-kit-admin-subject", "x-access-kit-admin-groups"],
      evidenceRefs: ["evidence/admin-auth/gateway-policy.json"]
    },
    adminRebac: {
      policyId: "policy:admin-control-plane",
      separateFromApplicationAuthorization: true,
      leastPrivilegeRoles: ["access-kit.operator", "access-kit.approver", "access-kit.auditor"],
      roleBindings: ["group:access-kit-operators->access-kit.operator"],
      revocationSlaMinutes: 15,
      evidenceRefs: ["evidence/admin-auth/admin-rebac-policy.json"]
    },
    secrets: {
      manager: "external_secret_manager",
      secretRefs: ["ref:access-kit/admin-gateway/client-secret"],
      rotationDays: 30,
      noPlaintextEnvironmentSecrets: true,
      evidenceRefs: ["evidence/admin-auth/secret-rotation.json"]
    },
    emergency: {
      breakGlassApprovalRequired: true,
      breakGlassApproverRoles: ["Security engineer", "ISSO"],
      temporaryElevationMaxMinutes: 60,
      incidentModeNotificationTargets: ["siem:admin-actions", "pagerduty:security"],
      postActionReviewRequired: true,
      evidenceRefs: ["runbooks/break-glass-review.md"]
    },
    audit: {
      auditEventTypes: ["admin.action", "admin.post_action_review", "api.authentication_failed"],
      evidenceExportRequired: true,
      evidenceRefs: ["runbooks/audit-evidence-export.md"]
    }
  }, overrides);
}

interface DescriptorOverrides {
  version?: AdminAuthorizationDescriptor["version"];
  authentication?: Partial<AdminAuthorizationDescriptor["authentication"]>;
  ingress?: Partial<AdminAuthorizationDescriptor["ingress"]>;
  adminRebac?: Partial<AdminAuthorizationDescriptor["adminRebac"]>;
  secrets?: Partial<AdminAuthorizationDescriptor["secrets"]>;
  emergency?: Partial<AdminAuthorizationDescriptor["emergency"]>;
  audit?: Partial<AdminAuthorizationDescriptor["audit"]>;
}

function mergeDescriptor(
  descriptor: AdminAuthorizationDescriptor,
  overrides: DescriptorOverrides
): AdminAuthorizationDescriptor {
  return {
    ...descriptor,
    ...overrides,
    authentication: { ...descriptor.authentication, ...overrides.authentication },
    ingress: { ...descriptor.ingress, ...overrides.ingress },
    adminRebac: { ...descriptor.adminRebac, ...overrides.adminRebac },
    secrets: { ...descriptor.secrets, ...overrides.secrets },
    emergency: { ...descriptor.emergency, ...overrides.emergency },
    audit: { ...descriptor.audit, ...overrides.audit }
  };
}
