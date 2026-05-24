import type { RebacLocalApp } from "./local-app.js";

type RuntimeReadinessStatus = "ready" | "ready_with_warnings" | "not_ready";
type RuntimeReadinessCheckStatus = "pass" | "warn" | "fail";

interface RuntimeReadinessCheck {
  name: string;
  status: RuntimeReadinessCheckStatus;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface RuntimeReadinessResponse {
  status: RuntimeReadinessStatus;
  version: string;
  checkedAt: string;
  checks: RuntimeReadinessCheck[];
}

export function buildRuntimeReadiness(app: RebacLocalApp, apiKeys: readonly string[]): RuntimeReadinessResponse {
  const connectorIds = [...app.connectors.keys()].sort();
  const checks: RuntimeReadinessCheck[] = [
    {
      name: "api_runtime",
      status: "pass",
      message: "API runtime accepted the readiness probe."
    },
    {
      name: "api_authentication",
      status: apiKeys.length > 0 ? "pass" : "warn",
      message: apiKeys.length > 0
        ? "Bearer-token guard is configured for protected API routes."
        : "Bearer-token guard is not configured; only local development should run without API keys.",
      evidence: {
        configured: apiKeys.length > 0
      }
    },
    {
      name: "state_repository",
      status: app.stateRepository ? "pass" : "warn",
      message: app.stateRepository
        ? "Runtime state snapshot repository is configured."
        : "Runtime state snapshot repository is not configured; state is in-memory only.",
      evidence: {
        configured: Boolean(app.stateRepository)
      }
    },
    {
      name: "graph_repository",
      status: app.graphRepository ? "pass" : "warn",
      message: app.graphRepository
        ? "Runtime graph repository is configured for local proof-point persistence."
        : "Runtime graph repository is not configured; graph state is in-memory only.",
      evidence: {
        configured: Boolean(app.graphRepository)
      }
    },
    {
      name: "job_repository",
      status: app.jobRepository ? "pass" : "warn",
      message: app.jobRepository
        ? "Runtime job repository is configured for local proof-point persistence."
        : "Runtime job repository is not configured; job state is in-memory only.",
      evidence: {
        configured: Boolean(app.jobRepository)
      }
    },
    {
      name: "audit_repository",
      status: app.auditRepository ? "pass" : "warn",
      message: app.auditRepository
        ? "Audit repository is configured for local proof-point persistence."
        : "Audit repository is not configured; audit events are in-memory only.",
      evidence: {
        configured: Boolean(app.auditRepository)
      }
    },
    {
      name: "evidence_repository",
      status: app.evidenceRepository ? "pass" : "warn",
      message: app.evidenceRepository
        ? "Evidence package repository is configured for local proof-point persistence."
        : "Evidence package repository is not configured; evidence packages are generated in-memory only.",
      evidence: {
        configured: Boolean(app.evidenceRepository)
      }
    },
    {
      name: "persistence_degradation",
      status: app.persistenceDegradations.length > 0 ? "warn" : "pass",
      message: app.persistenceDegradations.length > 0
        ? "Runtime persistence has recorded degraded local proof-point writes."
        : "Runtime persistence has not recorded degraded local proof-point writes.",
      evidence: {
        degradedWrites: app.persistenceDegradations.length,
        components: [...new Set(app.persistenceDegradations.map((item) => item.component))].sort()
      }
    },
    {
      name: "connectors",
      status: connectorIds.length > 0 ? "pass" : "fail",
      message: connectorIds.length > 0
        ? `${connectorIds.length} connector adapters are registered.`
        : "No connector adapters are registered.",
      evidence: {
        configured: connectorIds.length > 0
      }
    }
  ];

  return {
    status: summarizeReadiness(checks),
    version: "0.1.0",
    checkedAt: app.now(),
    checks
  };
}

function summarizeReadiness(checks: readonly RuntimeReadinessCheck[]): RuntimeReadinessStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "not_ready";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "ready_with_warnings";
  }

  return "ready";
}
