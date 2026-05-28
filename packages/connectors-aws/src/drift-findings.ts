import type { DiscoveryRunWarning, DriftFinding, Resource } from "@access-kit/core";
import { accessAnalyzerReconciliationConfidence } from "./latency-confidence.js";
import type {
  AwsAccessAnalyzerFinding,
  AwsEntityMaps,
  AwsLatencyWindows,
  AwsReconciliationConfidence
} from "./provider-models.js";
import { redactValue, safePermissionLabel } from "./provider-utils.js";

export interface AwsDriftFindingContext {
  connectorId: string;
  now: () => string;
  latencyWindows: AwsLatencyWindows;
  pushWarning: (warning: DiscoveryRunWarning) => void;
}

export function buildAwsDriftFindings(
  findings: AwsAccessAnalyzerFinding[],
  maps: AwsEntityMaps,
  context: AwsDriftFindingContext
): DriftFinding[] {
  const driftFindings: DriftFinding[] = [];

  for (const finding of findings) {
    if (!finding.id || finding.status === "ARCHIVED" || finding.status === "RESOLVED") {
      continue;
    }

    const resource = resolveFindingResource(finding, maps);
    const principalKey = accessAnalyzerPrincipalKey(finding.principal);
    const subject = principalKey ? maps.subjectsByPrincipalKey.get(principalKey) : undefined;
    if (!resource || !subject) {
      context.pushWarning({
        code: "AWS_ACCESS_ANALYZER_FINDING_SKIPPED",
        message: "Access Analyzer returned a finding outside the imported resource or principal boundary; the finding was retained as a coverage warning instead of a canonical drift fact.",
        severity: "warning",
        scope: "native_grants",
        retryable: false
      });
      continue;
    }

    const detectedAt = finding.updatedAt ?? finding.createdAt ?? context.now();
    const confidence = accessAnalyzerReconciliationConfidence(finding, maps, context.now(), context.latencyWindows);
    const severity = accessAnalyzerSeverity(finding, confidence);
    const recommendedAction = finding.isPublic ? "revoke" : "review";
    if (confidence.level !== "high") {
      context.pushWarning({
        code: "AWS_RECONCILIATION_CONFIDENCE_DEGRADED",
        message: `AWS access-analysis reconciliation confidence is ${confidence.level}; stale activity window ${confidence.staleActivityWindowMinutes}m, stale finding window ${confidence.staleFindingWindowMinutes}m, reasons: ${confidence.reasons.join(", ")}.`,
        severity: confidence.level === "low" ? "warning" : "info",
        scope: "native_grants",
        retryable: true
      });
    }

    driftFindings.push({
      id: `drift:${context.connectorId}:${redactValue(finding.id)}`,
      resourceId: resource.id,
      subjectId: subject.id,
      nativeAccess: accessAnalyzerNativeAccess(finding, confidence),
      intendedAccess: `no-approved-rebac-intent; reconciliation_confidence=${confidence.level}; stale_activity_window=${confidence.staleActivityWindowMinutes}m; stale_finding_window=${confidence.staleFindingWindowMinutes}m`,
      severity,
      lifecycleState: "open",
      ownerId: "role:security-operations",
      assigneeId: "role:security-engineer",
      detectedAt,
      sourceConnectorId: context.connectorId,
      recommendedAction,
      status: "open",
      scheduledReconciliation: {
        cadence: "manual",
        scheduledAt: detectedAt,
        gracePeriodHours: 0,
        overdue: false
      },
      hookEvidence: [],
      remediation: {},
      autoRepairPolicy: {
        enabled: false,
        allowedActions: [recommendedAction],
        maxSeverity: severity,
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false,
        reason: "AWS Access Analyzer drift findings require approval and read-only verification before any remediation plan."
      },
      version: "drift-finding:v1",
      createdAt: context.now()
    });
  }

  if (driftFindings.length > 0) {
    context.pushWarning({
      code: "AWS_ACCESS_ANALYZER_FINDINGS_OBSERVED",
      message: "Access Analyzer reported active findings; reconciliation exposes them as reviewable drift findings without mutating AWS.",
      severity: "warning",
      scope: "native_grants",
      retryable: false
    });
  }

  return driftFindings;
}

export function accessAnalyzerPrincipalKey(
  principal: AwsAccessAnalyzerFinding["principal"]
): string | undefined {
  if (typeof principal === "string") {
    return principal;
  }

  if (!principal) {
    return undefined;
  }

  return principal.AWS ?? principal.Federated ?? principal.Service ?? Object.values(principal).at(0);
}

function resolveFindingResource(finding: AwsAccessAnalyzerFinding, maps: AwsEntityMaps): Resource | undefined {
  if (finding.resource) {
    const direct = maps.resourcesByRawKey.get(finding.resource);
    if (direct) {
      return direct;
    }
  }

  return undefined;
}

function accessAnalyzerNativeAccess(
  finding: AwsAccessAnalyzerFinding,
  confidence: AwsReconciliationConfidence
): string {
  const actions = (finding.action ?? []).map(safePermissionLabel).filter((action) => action.length > 0);
  const type = finding.findingType ? safePermissionLabel(finding.findingType) : "access-analyzer";
  const nativeAccess = actions.length > 0 ? `${type}:${actions.join(",")}` : type;
  return `${nativeAccess}; reconciliation_confidence=${confidence.level}; stale_activity_window=${confidence.staleActivityWindowMinutes}m; stale_finding_window=${confidence.staleFindingWindowMinutes}m`;
}

function accessAnalyzerSeverity(
  finding: AwsAccessAnalyzerFinding,
  confidence: AwsReconciliationConfidence
): DriftFinding["severity"] {
  if (finding.isPublic) {
    return "critical";
  }

  if (finding.findingType === "ExternalAccess" || finding.principal) {
    return confidence.level === "low" ? "critical" : "high";
  }

  return confidence.level === "low" ? "high" : "medium";
}
