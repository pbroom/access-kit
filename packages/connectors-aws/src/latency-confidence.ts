import type { DiscoveryRunWarning } from "@access-kit/core";
import type {
  AwsAccessAnalyzerFinding,
  AwsAccountAssignment,
  AwsActivity,
  AwsActivityIndex,
  AwsCloudTrailEvent,
  AwsEntityMaps,
  AwsLatencyModel,
  AwsLatencyWindows,
  AwsReconciliationConfidence,
  AwsReconciliationConfidenceLevel
} from "./provider-models.js";
import { MILLISECONDS_PER_MINUTE, redactValue, safePermissionLabel } from "./provider-utils.js";

export const DEFAULT_EVENTBRIDGE_LATENCY_WINDOW_MINUTES = 5;
export const DEFAULT_CLOUDTRAIL_STALE_ACTIVITY_WINDOW_MINUTES = 60;
export const DEFAULT_ACCESS_ANALYZER_STALE_FINDING_WINDOW_MINUTES = 60;

export function buildActivityIndex(
  events: AwsCloudTrailEvent[],
  now: string,
  windows: AwsLatencyWindows
): AwsActivityIndex {
  const activityByRawKey = new Map<string, AwsActivity>();
  const activities: AwsActivity[] = [];
  const partialOrderingObserved = hasPartialOrdering(events);

  for (const event of events) {
    if (!event.eventTime) {
      continue;
    }

    const eventHash = redactValue(event.eventId ?? `${event.eventName}:${event.eventTime}`);
    const cloudTrailActivityAgeMinutes = minutesBetween(event.eventTime, now);
    const eventBridgeLatencyMinutes = event.eventBridgeDeliveredAt
      ? minutesBetween(event.eventTime, event.eventBridgeDeliveredAt)
      : undefined;
    const eventBridgeDeliveryPrecedesEvent = eventBridgeLatencyMinutes !== undefined && eventBridgeLatencyMinutes < 0;
    const eventBridgeAttempts = positiveIntegerOrUndefined(event.eventBridgeAttemptCount);
    const eventBridgeRetryState = event.eventBridgeRetryState
      ? safePermissionLabel(event.eventBridgeRetryState)
      : undefined;
    const retryObserved = Boolean(eventBridgeRetryState?.toLowerCase().includes("retry")) || (eventBridgeAttempts ?? 1) > 1;
    const staleActivity = cloudTrailActivityAgeMinutes === undefined
      ? true
      : cloudTrailActivityAgeMinutes > windows.cloudTrailStaleActivityWindowMinutes;
    const latencyWindowExceeded = eventBridgeLatencyMinutes === undefined
      ? false
      : eventBridgeLatencyMinutes > windows.eventBridgeLatencyWindowMinutes;
    const confidenceReasons = [
      ...(staleActivity ? ["cloudtrail_activity_stale"] : []),
      ...(latencyWindowExceeded ? ["eventbridge_latency_window_exceeded"] : []),
      ...(eventBridgeDeliveryPrecedesEvent ? ["eventbridge_delivery_precedes_event"] : []),
      ...(retryObserved ? ["eventbridge_retry_observed"] : []),
      ...(partialOrderingObserved ? ["partial_ordering_observed"] : [])
    ];
    const activity: AwsActivity = {
      eventHash,
      eventName: event.eventName ?? "unknown",
      eventTime: event.eventTime,
      readOnly: event.readOnly === true || event.readOnly === "true",
      cloudTrailActivityAgeMinutes,
      eventBridgeDeliveredAt: event.eventBridgeDeliveredAt,
      eventBridgeLatencyMinutes,
      eventBridgeAttempts,
      eventBridgeRetryState,
      staleActivity,
      staleWindowMinutes: windows.cloudTrailStaleActivityWindowMinutes,
      partialOrderingObserved,
      reconciliationConfidence: confidenceLevelForReasons(confidenceReasons),
      confidenceReasons
    };
    const rawKeys = new Set<string>();
    activities.push(activity);

    if (event.recipientAccountId) {
      rawKeys.add(event.recipientAccountId);
    }

    for (const resource of event.resources ?? []) {
      if (resource.resourceName) {
        rawKeys.add(resource.resourceName);
      }
    }

    for (const rawKey of rawKeys) {
      const current = activityByRawKey.get(rawKey);
      if (!current || current.eventTime < activity.eventTime) {
        activityByRawKey.set(rawKey, activity);
      }
    }
  }

  return {
    activityByRawKey,
    latencyModel: {
      windows,
      observedAt: now,
      eventBridge: {
        observed: activities.some((activity) => Boolean(activity.eventBridgeDeliveredAt)),
        maxLatencyMinutes: maxDefined(activities.map((activity) => activity.eventBridgeLatencyMinutes)),
        retryObserved: activities.some((activity) => activity.confidenceReasons.includes("eventbridge_retry_observed")),
        latencyWindowExceeded: activities.some((activity) => activity.confidenceReasons.includes("eventbridge_latency_window_exceeded")),
        partialOrderingObserved,
        redacted: true
      },
      cloudTrail: {
        latestEventAt: activities.map((activity) => activity.eventTime).sort().at(-1),
        maxActivityAgeMinutes: maxDefined(activities.map((activity) => activity.cloudTrailActivityAgeMinutes)),
        staleActivityObserved: activities.some((activity) => activity.staleActivity),
        redacted: true
      }
    }
  };
}

export function latestActivityForAssignment(
  assignment: AwsAccountAssignment,
  maps: AwsEntityMaps
): AwsActivity | undefined {
  return [
    assignment.permissionSetArn,
    assignment.accountId
  ].flatMap((key) => key ? [maps.latestActivityByRawKey.get(key)] : [])
    .filter((activity): activity is AwsActivity => Boolean(activity))
    .sort((a, b) => b.eventTime.localeCompare(a.eventTime))
    .at(0);
}

export function accessAnalyzerReconciliationConfidence(
  finding: AwsAccessAnalyzerFinding,
  maps: AwsEntityMaps,
  now: string,
  windows: AwsLatencyWindows
): AwsReconciliationConfidence {
  const findingTimestamp = finding.updatedAt ?? finding.createdAt;
  const findingAgeMinutes = findingTimestamp ? minutesBetween(findingTimestamp, now) : undefined;
  const activity = latestActivityForFinding(finding, maps);
  const reasons = [
    ...(findingAgeMinutes === undefined ? ["access_analyzer_timestamp_missing"] : []),
    ...(findingAgeMinutes !== undefined && findingAgeMinutes > windows.accessAnalyzerStaleFindingWindowMinutes
      ? ["access_analyzer_finding_stale"]
      : []),
    ...(activity ? activity.confidenceReasons : ["cloudtrail_activity_missing"]),
    ...(maps.latencyModel.eventBridge.partialOrderingObserved ? ["partial_ordering_observed"] : [])
  ];
  const uniqueReasons = [...new Set(reasons)];

  return {
    level: confidenceLevelForReasons(uniqueReasons),
    reasons: uniqueReasons.length > 0 ? uniqueReasons : ["within_latency_windows"],
    staleFindingWindowMinutes: windows.accessAnalyzerStaleFindingWindowMinutes,
    staleActivityWindowMinutes: windows.cloudTrailStaleActivityWindowMinutes
  };
}

export function pushAwsLatencyWarnings(
  latencyModel: AwsLatencyModel,
  pushWarning: (warning: DiscoveryRunWarning) => void
): void {
  pushWarning({
    code: "AWS_ASYNC_ACTIVITY_WINDOWS_MODELED",
    message: `AWS readback models EventBridge delivery latency (${latencyModel.windows.eventBridgeLatencyWindowMinutes}m), CloudTrail stale activity (${latencyModel.windows.cloudTrailStaleActivityWindowMinutes}m), and Access Analyzer stale finding (${latencyModel.windows.accessAnalyzerStaleFindingWindowMinutes}m) windows before treating access-analysis evidence as high confidence.`,
    severity: "info",
    scope: "native_grants",
    retryable: false
  });

  if (latencyModel.eventBridge.latencyWindowExceeded) {
    pushWarning({
      code: "AWS_EVENTBRIDGE_LATENCY_WINDOW_EXCEEDED",
      message: `EventBridge delivery lag exceeded the ${latencyModel.windows.eventBridgeLatencyWindowMinutes}m evidence window; reconciliation confidence is reduced until a later readback confirms ordering.`,
      severity: "warning",
      scope: "native_grants",
      retryable: true
    });
  }

  if (latencyModel.eventBridge.retryObserved) {
    pushWarning({
      code: "AWS_EVENTBRIDGE_RETRY_OBSERVED",
      message: "EventBridge delivery metadata showed retry behavior; retry evidence is retained as redacted activity metadata instead of canonical access intent.",
      severity: "info",
      scope: "native_grants",
      retryable: true
    });
  }

  if (latencyModel.eventBridge.partialOrderingObserved) {
    pushWarning({
      code: "AWS_EVENT_PARTIAL_ORDERING_OBSERVED",
      message: "CloudTrail event time and EventBridge delivery time are partially ordered; operators should treat per-grant activity recency as evidence with ordering uncertainty.",
      severity: "warning",
      scope: "native_grants",
      retryable: true
    });
  }

  if (latencyModel.cloudTrail.staleActivityObserved) {
    pushWarning({
      code: "AWS_CLOUDTRAIL_ACTIVITY_STALE",
      message: `CloudTrail activity exceeded the ${latencyModel.windows.cloudTrailStaleActivityWindowMinutes}m stale window; current-access readback remains authoritative but activity evidence is low confidence.`,
      severity: "warning",
      scope: "native_grants",
      retryable: true
    });
  }
}

function latestActivityForFinding(finding: AwsAccessAnalyzerFinding, maps: AwsEntityMaps): AwsActivity | undefined {
  return [
    finding.resource
  ].flatMap((key) => key ? [maps.latestActivityByRawKey.get(key)] : [])
    .filter((activity): activity is AwsActivity => Boolean(activity))
    .sort((a, b) => b.eventTime.localeCompare(a.eventTime))
    .at(0);
}

function confidenceLevelForReasons(reasons: string[]): AwsReconciliationConfidenceLevel {
  if (reasons.some((reason) => (
    reason.includes("stale") ||
    reason.includes("missing") ||
    reason.includes("failed") ||
    reason.includes("precedes")
  ))) {
    return "low";
  }

  return reasons.length > 0 ? "medium" : "high";
}

function hasPartialOrdering(events: AwsCloudTrailEvent[]): boolean {
  const deliveredEvents = events
    .filter((event): event is AwsCloudTrailEvent & { eventTime: string; eventBridgeDeliveredAt: string } =>
      Boolean(event.eventTime && event.eventBridgeDeliveredAt));

  return deliveredEvents.some((event, index) =>
    deliveredEvents.slice(index + 1).some((candidate) => {
      const eventTimeOrder = event.eventTime.localeCompare(candidate.eventTime);
      const deliveryOrder = event.eventBridgeDeliveredAt.localeCompare(candidate.eventBridgeDeliveredAt);
      return eventTimeOrder !== 0 && deliveryOrder !== 0 && Math.sign(eventTimeOrder) !== Math.sign(deliveryOrder);
    }));
}

function minutesBetween(start: string, end: string): number | undefined {
  const startMilliseconds = Date.parse(start);
  const endMilliseconds = Date.parse(end);
  if (!Number.isFinite(startMilliseconds) || !Number.isFinite(endMilliseconds)) {
    return undefined;
  }

  return Math.round(((endMilliseconds - startMilliseconds) / MILLISECONDS_PER_MINUTE) * 100) / 100;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return defined.length > 0 ? Math.max(...defined) : undefined;
}

function positiveIntegerOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
