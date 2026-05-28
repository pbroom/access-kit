export type CliApiSurface = `${"DELETE" | "GET" | "POST" | "PUT"} /v1/${string}` | "local";

export interface CliCommandSpec {
  path: string;
  description: string;
  apiSurface: CliApiSurface;
}

export const CLI_COMMANDS: CliCommandSpec[] = [
  { path: "ready", description: "Check API runtime readiness.", apiSurface: "GET /v1/ready" },
  { path: "subject sync", description: "Sync subjects from a connector.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "subject get", description: "Inspect a canonical subject.", apiSurface: "GET /v1/subjects/{id}" },
  { path: "subject access", description: "Explain current subject access.", apiSurface: "GET /v1/subjects/{id}/access" },
  // Discovery-oriented commands share the connector sync endpoint until provider-specific inventory endpoints land.
  { path: "resource discover", description: "Discover resources from a connector.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "resource get", description: "Inspect a canonical resource.", apiSurface: "GET /v1/resources/{id}" },
  { path: "resource access", description: "Explain resource access paths.", apiSurface: "GET /v1/resources/{id}/access" },
  { path: "resource native-access", description: "Inspect observed native grants for a resource.", apiSurface: "GET /v1/resources/{id}/native-access" },
  { path: "relation set", description: "Create or replace a relationship tuple.", apiSurface: "PUT /v1/relationships" },
  { path: "relation delete", description: "Delete a relationship tuple.", apiSurface: "DELETE /v1/relationships" },
  { path: "relation path", description: "Show relationship paths between subject and resource.", apiSurface: "GET /v1/relationships" },
  { path: "policy validate", description: "Validate a policy model.", apiSurface: "POST /v1/policies/{id}/validate" },
  { path: "policy test", description: "Run policy proof-point tests.", apiSurface: "POST /v1/policies/{id}/validate" },
  { path: "policy publish", description: "Publish an approved policy model.", apiSurface: "POST /v1/policies/{id}/publish" },
  { path: "check", description: "Run a fast allow/deny decision.", apiSurface: "POST /v1/decision/check" },
  { path: "explain", description: "Run an explainable decision.", apiSurface: "POST /v1/decision/explain" },
  { path: "provision plan", description: "Create a dry-run or controlled synthetic enforcement provisioning plan.", apiSurface: "POST /v1/provisioning/plans" },
  { path: "provision apply", description: "Run a dry-run or controlled synthetic enforcement provisioning job for a plan.", apiSurface: "POST /v1/provisioning/jobs" },
  { path: "provision revoke", description: "Create a revocation plan.", apiSurface: "POST /v1/provisioning/plans" },
  { path: "emergency revoke", description: "Create an approved emergency revocation plan.", apiSurface: "POST /v1/provisioning/plans" },
  { path: "reconcile run", description: "Run reconciliation for a connector.", apiSurface: "POST /v1/reconciliation/run" },
  { path: "reconcile findings", description: "List drift findings.", apiSurface: "GET /v1/reconciliation/findings" },
  { path: "reconcile remediate", description: "Plan approved dry-run remediation for a drift finding.", apiSurface: "POST /v1/reconciliation/findings/{id}/remediation" },
  { path: "discovery runs", description: "List read-only connector discovery runs.", apiSurface: "GET /v1/discovery/runs" },
  { path: "audit search", description: "Search append-only audit events.", apiSurface: "GET /v1/audit/events" },
  { path: "audit integrity", description: "Verify append-only audit hash-chain integrity.", apiSurface: "GET /v1/audit/integrity" },
  { path: "audit export", description: "Export SIEM-ready audit events.", apiSurface: "GET /v1/audit/export" },
  { path: "evidence export", description: "Export ATO evidence.", apiSurface: "GET /v1/evidence/export" },
  { path: "evidence verify", description: "Verify an exported signed evidence package.", apiSurface: "POST /v1/evidence/verify" },
  { path: "connector list", description: "List connectors and capabilities.", apiSurface: "GET /v1/connectors" },
  { path: "connector test", description: "Test connector health and permissions.", apiSurface: "POST /v1/connectors/{id}/test" },
  { path: "connector readiness", description: "Check controlled-enforcement readiness for a connector.", apiSurface: "POST /v1/connectors/{id}/enforcement-readiness" },
  { path: "connector sync", description: "Run connector discovery or reconciliation.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "completion", description: "Print shell completion for bash, zsh, or fish.", apiSurface: "local" }
];
