import type {
  ConnectorHealthCheck,
  DiscoveryRun,
  NativeGrant,
  NativeGrantType,
  NativePrincipalType
} from "@access-kit/core";
import type { RebacLocalApp } from "./runtime-app.js";
import { compactTimestamp, getConnector, nextAppRecordSequence } from "./runtime-shared.js";
import {
  persistAppState,
  persistConnectorDiscoveryGraph,
  persistJobDiscoveryRun,
  recordAudit
} from "./runtime-state.js";

export type NativeAccessFilter = Partial<
  Pick<NativeGrant, "sourceConnectorId" | "subjectId" | "nativePermission"> & {
    grantType: NativeGrantType;
    principalType: NativePrincipalType;
  }
>;

export async function syncConnector(
  app: RebacLocalApp,
  connectorId: string,
  mode: "read_only"
): Promise<DiscoveryRun> {
  const connector = getConnector(app, connectorId);
  const startedAt = app.now();
  const runSequence = nextAppRecordSequence(app, `discovery:${connectorId}`, app.store.listDiscoveryRuns({ connectorId }).length);
  const runKey = `${connectorId}:${compactTimestamp(startedAt)}:${runSequence}`;
  connector.mode = mode;
  const initialMetadata = connector.getDiscoveryMetadata?.();
  const subjects = await connector.discoverSubjects();
  const resources = await connector.discoverResources();
  const relationships = await connector.discoverRelationships();

  subjects.forEach((subject) => app.store.upsertSubject(subject));
  resources.forEach((resource) => app.store.upsertResource(resource));
  relationships.forEach((relationship) => app.store.upsertRelationship(relationship));

  const nativeGrants: NativeGrant[] = [];
  for (const resource of resources) {
    const grants = await connector.readCurrentAccess(resource.id);
    nativeGrants.push(...grants);
  }
  const readbackMetadata = connector.getDiscoveryMetadata?.() ?? initialMetadata;
  if (readbackMetadata?.nativeAccessReadbackComplete !== false) {
    app.store.replaceNativeGrantsForConnector(connectorId, nativeGrants);
  }

  const completedAt = app.now();
  const metadata = connector.getDiscoveryMetadata?.() ?? readbackMetadata;
  const warnings = metadata?.warnings ?? [];
  const run: DiscoveryRun = {
    id: `discovery:${runKey}`,
    connectorId,
    mode: "read_only",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    startedAt,
    completedAt,
    counts: {
      subjects: subjects.length,
      resources: resources.length,
      relationships: relationships.length,
      nativeGrants: nativeGrants.length,
      warnings: warnings.length
    },
    warnings,
    cursor: metadata?.cursor,
    evidence: {
      readOnly: true,
      schemas: ["subject", "resource", "relationship", "native-grant", "discovery-run"],
      connectorCapabilities: Object.entries(connector.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
      nativeAccessReadback: nativeGrants.length > 0
    },
    auditEventIds: [],
    version: "discovery-run:v1",
    createdAt: startedAt,
    updatedAt: completedAt
  };

  const auditEvent = recordAudit(app, {
    eventType: "connector.discovery_completed",
    actor: app.actor,
    correlationId: `corr:connector-discovery:${runKey}`,
    payload: {
      action: "connector.discovery.read_only",
      connectorId,
      provider: metadata?.provider ?? connector.provider ?? connector.id,
      tenantBoundary: metadata?.tenantBoundary ?? connector.tenantBoundary ?? "synthetic:unknown",
      mode: run.mode,
      status: run.status,
      counts: run.counts,
      warnings: run.warnings,
      cursor: run.cursor,
      evidence: run.evidence,
      discoveryRunId: run.id
    }
  }, { persistState: false });

  const completedRun = { ...run, auditEventIds: [auditEvent.eventId] };
  app.store.recordDiscoveryRun(completedRun);
  persistConnectorDiscoveryGraph(app, { subjects, resources, relationships, nativeGrants }, completedAt);
  persistJobDiscoveryRun(app, completedRun, completedAt);
  persistAppState(app, completedAt);
  return completedRun;
}

export function listDiscoveryRuns(
  app: RebacLocalApp,
  filter: Partial<Pick<DiscoveryRun, "connectorId" | "status">> = {}
): DiscoveryRun[] {
  return app.store.listDiscoveryRuns(filter);
}

export function readNativeAccess(app: RebacLocalApp, resourceId: string, filter: NativeAccessFilter = {}): NativeGrant[] {
  const grants = app.store.listNativeGrants({
    targetObjectId: resourceId,
    ...filter
  });

  recordAudit(app, {
    eventType: "connector.current_access_read",
    actor: app.actor,
    resourceId,
    correlationId: `corr:connector-current-access:${resourceId}:${compactTimestamp(app.now())}`,
    payload: {
      action: "connector.current_access.read",
      resourceId,
      filters: filter,
      resultCount: grants.length
    }
  });

  return grants;
}

export async function testConnector(app: RebacLocalApp, connectorId: string): Promise<{ valid: boolean; checks: ConnectorHealthCheck[] }> {
  const connector = app.connectors.get(connectorId);

  if (!connector) {
    return {
      valid: false,
      checks: [
        {
          name: "connector_registered",
          status: "fail",
          message: `Connector ${connectorId} is not registered.`
        }
      ]
    };
  }

  const checks = connector.testReadOnlyAccess
    ? await connector.testReadOnlyAccess()
    : [
        {
          name: "connector_registered",
          status: "pass" as const,
          message: `${connectorId} is registered.`
        }
      ];

  return {
    valid: checks.every((check) => check.status !== "fail"),
    checks
  };
}
