import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkEnforcementReadiness,
  createRebacLocalApp,
  testConnector,
  type RebacLocalApp
} from "../packages/api/src/local-app.js";
import type {
  ConnectorAdapter,
  ConnectorDiscoveryMetadata,
  ConnectorSecurityReview,
  EnforcementControl
} from "../packages/core/src/index.js";

const root = process.cwd();
const requiredConnectorIds = ["mock", "entra-readonly", "sharepoint-readonly", "aws-readonly"] as const;
const safeSyntheticControl: EnforcementControl = {
  syntheticOnly: true,
  liveProviderWrites: false,
  incidentMode: false,
  breakGlass: false
};

export interface ConnectorSecurityGateResult {
  connectorId: string;
  checks: string[];
}

export async function validateConnectorSecurityGate(app: RebacLocalApp): Promise<ConnectorSecurityGateResult[]> {
  const failures: string[] = [];
  const results: ConnectorSecurityGateResult[] = [];

  for (const connectorId of requiredConnectorIds) {
    if (!app.connectors.has(connectorId)) {
      failures.push(`Missing required connector registration: ${connectorId}`);
    }
  }

  for (const connector of app.connectors.values()) {
    const checks: string[] = [];
    const review = connector.getSecurityReview?.();
    const metadata = connector.getDiscoveryMetadata?.();

    if (!review) {
      failures.push(`${connector.id}: connector must expose getSecurityReview().`);
      continue;
    }

    if (!metadata) {
      failures.push(`${connector.id}: connector must expose getDiscoveryMetadata().`);
      continue;
    }

    validateIdentityAndConsent(connector, review, metadata, checks, failures);
    await validateReadOnlyGate(app, connector, review, metadata, checks, failures);
    validateOperations(review, metadata, checks, failures);
    validateSecretHandling(review, checks, failures);
    await validateNoWriteReadiness(app, connector, review, checks, failures);

    results.push({ connectorId: connector.id, checks });
  }

  if (failures.length > 0) {
    throw new Error(`Connector security gate failed:\n- ${failures.join("\n- ")}`);
  }

  return results;
}

async function main(): Promise<void> {
  const app = createRebacLocalApp({ now: () => "2026-05-26T00:00:00.000Z" });
  const results = await validateConnectorSecurityGate(app);

  console.log(`Validated connector security gates for ${results.length} connector(s).`);
  for (const result of results) {
    console.log(`PASS ${result.connectorId}: ${result.checks.join("; ")}`);
  }
}

function validateIdentityAndConsent(
  connector: ConnectorAdapter,
  review: ConnectorSecurityReview,
  metadata: ConnectorDiscoveryMetadata,
  checks: string[],
  failures: string[]
): void {
  const provider = connector.provider ?? connector.id;
  const tenantBoundary = connector.tenantBoundary ?? "";
  const requiredReadScopes = connector.requiredReadScopes ?? [];

  requireEquals(review.connectorId, connector.id, `${connector.id}: review connectorId`, failures);
  requireEquals(review.provider, provider, `${connector.id}: review provider`, failures);
  requireEquals(review.tenantBoundary, tenantBoundary, `${connector.id}: review tenant boundary`, failures);
  requireEquals(metadata.provider, provider, `${connector.id}: metadata provider`, failures);
  requireEquals(metadata.tenantBoundary, tenantBoundary, `${connector.id}: metadata tenant boundary`, failures);

  if (!tenantBoundary || tenantBoundary === "synthetic:unknown") {
    failures.push(`${connector.id}: tenant boundary must be explicit and cannot use the fallback boundary.`);
  }

  if (review.synthetic !== metadata.synthetic) {
    failures.push(`${connector.id}: review and discovery metadata must agree on synthetic status.`);
  }

  if (review.synthetic) {
    if (review.identity.kind !== "synthetic" || review.consent.status !== "synthetic") {
      failures.push(`${connector.id}: synthetic connector security review must use synthetic identity and synthetic consent.`);
    }
  } else if (review.identity.kind === "synthetic" || review.consent.status !== "approved") {
    failures.push(`${connector.id}: live-read connector security review must use a non-synthetic identity and approved consent.`);
  }

  requireSameSet(review.consent.scopesApproved, requiredReadScopes, `${connector.id}: consent scopes`, failures);
  requireSameSet(review.leastPrivilege.requiredReadScopes, requiredReadScopes, `${connector.id}: least-privilege read scopes`, failures);
  requireSameSet(metadata.requiredReadScopes, requiredReadScopes, `${connector.id}: metadata read scopes`, failures);
  requireNoDuplicates(requiredReadScopes, `${connector.id}: required read scopes`, failures);
  requireNoDuplicates(review.leastPrivilege.forbiddenWriteScopes, `${connector.id}: forbidden write scopes`, failures);
  requireEvidenceFiles(review.identity.evidence, `${connector.id}: identity evidence`, failures);
  requireEvidenceFiles(review.consent.evidence, `${connector.id}: consent evidence`, failures);

  if (requiredReadScopes.length === 0) {
    failures.push(`${connector.id}: required read scopes must not be empty.`);
  }

  for (const scope of requiredReadScopes) {
    if (review.synthetic) {
      if (!scope.startsWith("synthetic:") || !scope.includes(".read") || isWriteScope(scope)) {
        failures.push(`${connector.id}: scope ${scope} must be synthetic, read-only, and non-writing.`);
      }
    } else if (!isApprovedLiveReadScope(scope)) {
      failures.push(`${connector.id}: scope ${scope} must be an approved live read-only provider scope.`);
    }
  }

  for (const scope of review.leastPrivilege.forbiddenWriteScopes) {
    if (!isWriteScope(scope)) {
      failures.push(`${connector.id}: forbidden scope ${scope} must describe a write capability.`);
    }
  }

  const forbiddenReadOverlap = review.leastPrivilege.forbiddenWriteScopes.filter((scope) => requiredReadScopes.includes(scope));
  if (forbiddenReadOverlap.length > 0) {
    failures.push(`${connector.id}: forbidden write scopes overlap with required read scopes: ${forbiddenReadOverlap.join(", ")}`);
  }

  checks.push("identity, consent, tenant boundary, and least-privilege scopes match runtime metadata");
}

async function validateReadOnlyGate(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  review: ConnectorSecurityReview,
  metadata: ConnectorDiscoveryMetadata,
  checks: string[],
  failures: string[]
): Promise<void> {
  if (connector.mode !== "read_only") {
    failures.push(`${connector.id}: connector mode must default to read_only.`);
  }

  if (connector.provider !== "mock" && connector.capabilities.supportsProvisioning) {
    failures.push(`${connector.id}: non-mock connectors must not advertise provisioning support before live review.`);
  }

  if (!connector.capabilities.supportsDiscovery || !connector.capabilities.supportsReconciliation) {
    failures.push(`${connector.id}: connector must support discovery and reconciliation readback.`);
  }

  if (!review.operations.nativeAccessReadback || !metadata.requiredReadScopes.length) {
    failures.push(`${connector.id}: connector security review must require native-access readback and scoped discovery evidence.`);
  }

  const health = await testConnector(app, connector.id);
  if (!health.valid) {
    failures.push(`${connector.id}: read-only connector test failed.`);
  }

  requireHealthCheckPass(connector.id, health.checks, "connector_registered", failures);
  requireHealthCheckPass(connector.id, health.checks, "read_only_mode", failures);

  for (const scope of connector.requiredReadScopes ?? []) {
    requireHealthCheckPass(connector.id, health.checks, `scope:${scope}`, failures);
  }

  checks.push("read-only health checks and scope checks pass");
}

function validateOperations(
  review: ConnectorSecurityReview,
  metadata: ConnectorDiscoveryMetadata,
  checks: string[],
  failures: string[]
): void {
  if (review.operations.pagination !== "required") {
    failures.push(`${review.connectorId}: pagination behavior must be reviewed before live connector work.`);
  }

  if (review.operations.throttling !== "required") {
    failures.push(`${review.connectorId}: throttling behavior must be reviewed before live connector work.`);
  }

  if (review.operations.coverageWarnings !== "required") {
    failures.push(`${review.connectorId}: coverage warnings must be required.`);
  }

  if (metadata.cursor) {
    requireEquals(review.operations.deletion, metadata.cursor.deletedObjectBehavior, `${review.connectorId}: deletion behavior`, failures);
  } else if (review.operations.deletion === "not_applicable") {
    failures.push(`${review.connectorId}: deletion semantics cannot be not_applicable for provider discovery connectors.`);
  }

  checks.push("pagination, throttling, deletion, coverage-warning, and native-readback semantics are reviewed");
}

function validateSecretHandling(review: ConnectorSecurityReview, checks: string[], failures: string[]): void {
  if (review.synthetic && (review.secrets.storesSecrets || review.secrets.handling !== "none" || review.secrets.rotation !== "not_applicable")) {
    failures.push(`${review.connectorId}: synthetic connectors must not store secrets or require runtime secret rotation.`);
  }

  if (!review.synthetic) {
    if (review.secrets.storesSecrets) {
      failures.push(`${review.connectorId}: live-read connectors must not store secret material in connector state.`);
    }

    if (review.secrets.handling === "none") {
      failures.push(`${review.connectorId}: live-read connectors must require managed identity or vault-backed secret handling.`);
    }

    if (review.secrets.handling === "vault_required" && review.secrets.rotation !== "required") {
      failures.push(`${review.connectorId}: vault-backed live-read credentials must require rotation evidence.`);
    }
  }

  requireEvidenceFiles(review.secrets.evidence, `${review.connectorId}: secret-handling evidence`, failures);
  checks.push(review.synthetic ? "secret handling is documented as synthetic/no-secret" : "secret handling is documented as managed identity or vault-backed with no stored secrets");
}

async function validateNoWriteReadiness(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  review: ConnectorSecurityReview,
  checks: string[],
  failures: string[]
): Promise<void> {
  if (review.enforcement.liveWritesAllowed) {
    failures.push(`${connector.id}: connector security review must not allow live writes.`);
  }

  if (!review.enforcement.readinessRequired || !review.enforcement.rollbackRequired || !review.enforcement.emergencyRevocationRequired) {
    failures.push(`${connector.id}: enforcement review must require readiness, rollback, and emergency revocation controls.`);
  }

  if (!review.enforcement.monitoringRequired) {
    failures.push(`${connector.id}: enforcement review must require monitoring evidence.`);
  }

  const readiness = await checkEnforcementReadiness(app, connector.id, {
    control: safeSyntheticControl,
    requiredApproverRole: "access-approver",
    changeTicketPattern: "^chg:[a-z0-9_:-]+$"
  });

  if (readiness.liveProviderWritesAllowed) {
    failures.push(`${connector.id}: readiness report must keep liveProviderWritesAllowed=false.`);
  }

  if (connector.provider === "mock") {
    if (readiness.status !== "ready" || !review.enforcement.controlledSyntheticOnly) {
      failures.push(`${connector.id}: mock connector may only be ready for controlled synthetic enforcement.`);
    }
  } else if (readiness.status !== "blocked" || review.enforcement.controlledSyntheticOnly) {
    failures.push(`${connector.id}: provider-style connectors must remain blocked for enforcement before live least-privilege review.`);
  }

  checks.push("live writes remain blocked and readiness gate preserves synthetic-only enforcement");
}

function requireHealthCheckPass(
  connectorId: string,
  checks: Array<{ name: string; status: string }>,
  name: string,
  failures: string[]
): void {
  const check = checks.find((item) => item.name === name);
  if (!check) {
    failures.push(`${connectorId}: missing connector health check ${name}.`);
  } else if (check.status !== "pass") {
    failures.push(`${connectorId}: connector health check ${name} must pass.`);
  }
}

function requireEquals<T>(actual: T, expected: T, label: string, failures: string[]): void {
  if (actual !== expected) {
    failures.push(`${label} must be ${String(expected)}, got ${String(actual)}.`);
  }
}

function requireSameSet(actual: readonly string[], expected: readonly string[], label: string, failures: string[]): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (actualSorted.length !== expectedSorted.length || actualSorted.some((value, index) => value !== expectedSorted[index])) {
    failures.push(`${label} must match ${expectedSorted.join(", ")}; got ${actualSorted.join(", ")}.`);
  }
}

function requireNoDuplicates(values: readonly string[], label: string, failures: string[]): void {
  if (new Set(values).size !== values.length) {
    failures.push(`${label} must not contain duplicates.`);
  }
}

function isApprovedLiveReadScope(scope: string): boolean {
  return (
    ["User.Read.All", "GroupMember.Read.All", "Application.Read.All"].includes(scope) &&
    !isWriteScope(scope)
  );
}

function isWriteScope(scope: string): boolean {
  return /write/i.test(scope) || /readwrite/i.test(scope);
}

function requireEvidenceFiles(paths: readonly string[], label: string, failures: string[]): void {
  if (paths.length === 0) {
    failures.push(`${label} must list at least one evidence reference.`);
    return;
  }

  for (const path of paths) {
    if (!existsSync(join(root, path))) {
      failures.push(`${label} references missing file ${path}.`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
