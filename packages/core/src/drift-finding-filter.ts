import type { DriftFinding } from "./domain.js";
import type { DriftFindingFilter } from "./persistence.js";

export function matchesDriftFindingFilter(finding: DriftFinding, filter: DriftFindingFilter): boolean {
  return (!filter.severity || finding.severity === filter.severity)
    && (!filter.status || finding.status === filter.status)
    && (!filter.lifecycleState || finding.lifecycleState === filter.lifecycleState)
    && (!filter.ownerId || finding.ownerId === filter.ownerId)
    && (!filter.assigneeId || finding.assigneeId === filter.assigneeId);
}
