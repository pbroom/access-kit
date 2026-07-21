import { describe, expect, it } from "vitest";
import {
  InMemoryExternalSnapshotStore,
  ReferenceJobQueueAdapter,
  type DiscoveryRun,
  type EvidenceExport,
  type ReferenceJobQueueStoreRecord,
  type ProvisioningApproval,
  type ProvisioningJob,
  type ReconciliationRun
} from "../../packages/core/src/index.js";
import {
  checkEnforcementReadiness,
  createProvisioningPlan,
  createRebacLocalApp,
  drainNextQueuedJob
} from "../../packages/api/src/index.js";

describe("queued API runtime worker", () => {
  it("drains discovery, reconciliation, provisioning, evidence, and revocation work through runtime flows", async () => {
    const now = () => "2026-05-26T04:00:00.000Z";
    const queue = createQueue(now);
    const app = createRebacLocalApp({ now, jobQueue: queue });

    queue.enqueueJob({
      kind: "discovery",
      connectorId: "mock",
      idempotencyKey: "idem:queue:discovery",
      requestedAt: now(),
      payload: { connectorId: "mock", mode: "read_only" }
    });
    const discovery = await drainNextQueuedJob(app, { workerId: "worker:queue-test" });
    expect(discovery.status).toBe("completed");
    expect(discovery.queueJob).toMatchObject({ kind: "discovery", status: "completed" });
    expect(["completed", "completed_with_warnings"]).toContain((discovery.result as DiscoveryRun).status);

    queue.enqueueJob({
      kind: "reconciliation",
      connectorId: "mock",
      idempotencyKey: "idem:queue:reconciliation",
      requestedAt: now(),
      payload: { connectorId: "mock" }
    });
    const reconciliation = await drainNextQueuedJob(app, { workerId: "worker:queue-test" });
    expect(reconciliation.status).toBe("completed");
    expect((reconciliation.result as ReconciliationRun).counts.findings).toBeGreaterThanOrEqual(0);

    const plan = await createProvisioningPlan(
      app,
      { subjectId: "user:alice", action: "read", resourceId: "document:case-plan" },
      "mock",
      { mode: "dry_run" },
      "idem:queue:plan"
    );
    queue.enqueueJob({
      kind: "provisioning",
      connectorId: "mock",
      idempotencyKey: "idem:queue:provisioning",
      requestedAt: now(),
      payload: {
        planId: plan.id,
        approverId: "user:approver",
        idempotencyKey: "idem:queue:provisioning:job",
        mode: "dry_run"
      }
    });
    const provisioning = await drainNextQueuedJob(app, { workerId: "worker:queue-test" });
    expect(provisioning.status).toBe("completed");
    expect(provisioning.result as ProvisioningJob).toMatchObject({
      mode: "dry_run",
      dryRun: true,
      status: "completed"
    });

    queue.enqueueJob({
      kind: "evidence",
      connectorId: "mock",
      idempotencyKey: "idem:queue:evidence",
      requestedAt: now(),
      payload: { controls: ["AC-3"], format: "json" }
    });
    const evidence = await drainNextQueuedJob(app, { workerId: "worker:queue-test" });
    expect(evidence.status).toBe("completed");
    expect(evidence.result as EvidenceExport).toMatchObject({
      format: "json",
      controls: ["AC-3"]
    });

    queue.enqueueRevocationJob({
      connectorId: "mock",
      nativeGrantId: "native-grant:mock:document:case-plan:user:alice:read:direct",
      idempotencyKey: "idem:queue:revocation",
      requestedAt: now()
    });
    const revocation = await drainNextQueuedJob(app, { workerId: "worker:queue-test" });
    expect(revocation.status).toBe("completed");
    expect(revocation.queueJob).toMatchObject({
      kind: "revocation",
      priority: "emergency",
      status: "completed"
    });
    expect(revocation.result as ProvisioningJob).toMatchObject({
      mode: "dry_run",
      status: "completed"
    });

    expect(queue.listQueuedJobs().every((job) => job.status === "completed")).toBe(true);
  });

  it("revalidates enforcement approval and readiness at execution time before acking", async () => {
    let currentTime = "2026-05-21T17:00:00.000Z";
    const now = () => currentTime;
    const queue = createQueue(now);
    const app = createRebacLocalApp({ now, jobQueue: queue });
    const control = controlledEnforcement();
    const approval: ProvisioningApproval = {
      decision: "approved",
      approverId: "user:approver",
      changeTicket: "chg:queue-controlled-enforcement",
      approvedAt: currentTime,
      expiresAt: "2026-05-21T17:05:00.000Z"
    };
    const readiness = await checkEnforcementReadiness(app, "mock", {
      mode: "enforcement",
      control,
      changeTicketPattern: "^chg:[a-z0-9_:-]+$"
    });
    const plan = await createProvisioningPlan(
      app,
      { subjectId: "user:alice", action: "read", resourceId: "document:case-plan" },
      "mock",
      {
        mode: "enforcement",
        approval,
        control,
        readinessReportId: readiness.id
      },
      "idem:queue:enforcement:plan"
    );

    queue.enqueueJob({
      kind: "provisioning",
      connectorId: "mock",
      idempotencyKey: "idem:queue:enforcement",
      requestedAt: currentTime,
      maxAttempts: 1,
      approval,
      control,
      readinessReportId: readiness.id,
      payload: {
        planId: plan.id,
        approverId: approval.approverId,
        idempotencyKey: "idem:queue:enforcement:job",
        mode: "enforcement"
      }
    });

    currentTime = "2026-05-21T17:06:00.000Z";
    const result = await drainNextQueuedJob(app, { workerId: "worker:queue-test" });

    expect(result.status).toBe("dead_lettered");
    expect(result.error).toContain("expired");
    expect(queue.listDeadLetteredJobs()).toEqual([
      expect.objectContaining({
        kind: "provisioning",
        lastError: expect.stringContaining("expired")
      })
    ]);
  });

  it("uses the queued job connector id instead of a conflicting payload connector id", async () => {
    const now = () => "2026-05-26T04:00:00.000Z";
    const queue = createQueue(now);
    const app = createRebacLocalApp({ now, jobQueue: queue });

    queue.enqueueJob({
      kind: "discovery",
      connectorId: "mock",
      idempotencyKey: "idem:queue:canonical-connector",
      requestedAt: now(),
      payload: { connectorId: "missing-connector", mode: "read_only" }
    });

    const result = await drainNextQueuedJob(app, { workerId: "worker:queue-test" });

    expect(result.status).toBe("completed");
    expect(result.queueJob).toMatchObject({ connectorId: "mock", status: "completed" });
    expect(result.result as DiscoveryRun).toMatchObject({ connectorId: "mock" });
  });
});

function createQueue(now: () => string): ReferenceJobQueueAdapter {
  return new ReferenceJobQueueAdapter({
    store: new InMemoryExternalSnapshotStore<ReferenceJobQueueStoreRecord>(),
    tenantBoundary: "synthetic:mock",
    location: "external://queue/access-kit-test-runtime",
    now
  });
}

function controlledEnforcement() {
  return {
    syntheticOnly: true,
    liveProviderWrites: false,
    incidentMode: false,
    breakGlass: false
  };
}
