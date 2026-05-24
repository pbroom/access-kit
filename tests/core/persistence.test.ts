import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuditRecorder,
  auditEventHash,
  assessPersistenceDeploymentReadiness,
  assessPersistenceReadiness,
  createLocalEngineSeed,
  InMemoryRebacPersistenceRepository,
  LocalAppendOnlyAuditRepository,
  LocalJsonFileGraphRepository,
  LocalJsonFileJobRepository,
  type AuditEvent,
  type DecisionResult,
  type DiscoveryRun,
  type DriftFinding,
  type EnforcementReadinessReport,
  type NativeGrant,
  type PersistenceBackendDescriptor,
  type PersistenceDeploymentManifest,
  type ProvisioningJob,
  type ProvisioningPlan,
  type RebacJobRepository,
  type ReconciliationRun,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "../../packages/core/src/index.js";

const now = "2026-05-21T17:00:00.000Z";

describe("persistent ReBAC repository contracts", () => {
  it("keeps graph facts, native grants, and jobs as separate persistence concepts", () => {
    const repository = new InMemoryRebacPersistenceRepository(createLocalEngineSeed());
    const nativeGrant = createNativeGrant();
    const plan = createProvisioningPlan();
    const job = createProvisioningJob();

    repository.upsertNativeGrant(nativeGrant);
    repository.upsertProvisioningPlan(plan);
    repository.upsertProvisioningJob(job);

    expect(repository.exportGraph()).toMatchObject({
      subjects: expect.any(Array),
      resources: expect.any(Array),
      relationships: expect.any(Array),
      nativeGrants: [nativeGrant]
    });
    expect(repository.exportJobs()).toMatchObject({
      provisioningPlans: [plan],
      provisioningJobs: [job]
    });
    expect(repository.listNativeGrants({ sourceConnectorId: "mock", nativePermission: "read" })).toEqual([nativeGrant]);
    expect(repository.listProvisioningPlans()).toEqual([plan]);
    expect(repository.getProvisioningJobByIdempotencyKey("idem:job:alice-case-plan-read")).toEqual(job);
    expect(repository.exportGraph()).not.toHaveProperty("provisioningJobs");
  });

  it("returns defensive copies from the in-memory conformance adapter", () => {
    const repository = new InMemoryRebacPersistenceRepository(createLocalEngineSeed());
    const subjects = repository.listSubjects();
    const plan = createProvisioningPlan();

    repository.upsertProvisioningPlan(plan);
    subjects[0] = { ...subjects[0], displayName: "Mutated Outside Store" };
    repository.listProvisioningPlans()[0] = { ...plan, status: "approved" };

    expect(repository.getSubject("user:alice")?.displayName).toBe("Alice Example");
    expect(repository.getProvisioningPlan(plan.id)?.status).toBe("planned");
  });

  it("describes the in-memory graph adapter without advertising job capabilities on the graph descriptor", () => {
    const repository = new InMemoryRebacPersistenceRepository(createLocalEngineSeed());

    expect(repository.describePersistence()).toMatchObject({
      component: "graph",
      backend: "memory",
      durable: false,
      immutable: false,
      capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback"]
    });
    expect(repository.describePersistence().capabilities).not.toContain("job_enqueue");
    expect(repository.describePersistence().capabilities).not.toContain("idempotency_lookup");
  });

  it("persists graph facts to a local JSON graph file and reloads them separately from jobs", () => {
    const graphPath = join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json");
    const repository = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    const subject = createSubject();
    const resource = createResource();
    const relationship = createRelationship();
    const nativeGrant = createNativeGrant();

    repository.upsertSubject(subject);
    repository.upsertResource(resource);
    repository.upsertRelationship(relationship);
    repository.upsertNativeGrant(nativeGrant);
    const receipt = repository.flush(now);

    expect(receipt).toMatchObject({
      backend: "local_file",
      location: "graph-state.json",
      graphHash: expect.stringMatching(/^sha256:/),
      entityCounts: {
        subjects: 1,
        resources: 1,
        relationships: 1,
        nativeGrants: 1
      }
    });

    const stored = JSON.parse(readFileSync(graphPath, "utf8")) as {
      version: string;
      graph: Record<string, unknown>;
    };
    expect(stored.version).toBe("rebac-graph-state:v1");
    expect(stored.graph).not.toHaveProperty("provisioningJobs");
    expect(stored.graph).not.toHaveProperty("auditEvents");

    const reopened = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    expect(reopened.getSubject(subject.id)).toEqual(subject);
    expect(reopened.getResource(resource.id)).toEqual(resource);
    expect(reopened.listRelationships({ subjectId: subject.id, relation: "reader" })).toEqual([relationship]);
    expect(reopened.listNativeGrants({ sourceConnectorId: "mock", nativePermission: "read" })).toEqual([nativeGrant]);

    reopened.listSubjects()[0] = { ...subject, displayName: "Mutated Outside Repository" };
    expect(reopened.getSubject(subject.id)?.displayName).toBe("Bob Example");
  });

  it("marks deleted relationships in the persisted graph snapshot without backdating storage time", () => {
    const graphPath = join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json");
    const storedAt = "2026-05-21T19:00:00.000Z";
    const repository = new LocalJsonFileGraphRepository({ graphPath, now: () => storedAt });
    const relationship = createRelationship();
    const deletedAt = "2026-05-21T18:00:00.000Z";

    repository.upsertRelationship(relationship);
    expect(repository.deleteRelationship(relationship.id, deletedAt)).toMatchObject({
      id: relationship.id,
      status: "deleted",
      updatedAt: deletedAt
    });

    const stored = JSON.parse(readFileSync(graphPath, "utf8")) as {
      storedAt: string;
      graph: { relationships: RelationshipTuple[] };
    };
    expect(stored.storedAt).toBe(storedAt);
    expect(stored.graph.relationships[0]?.updatedAt).toBe(deletedAt);

    const reopened = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    expect(reopened.getRelationship(relationship.id)).toMatchObject({
      id: relationship.id,
      status: "deleted"
    });
  });

  it("rejects tampered local graph snapshots before serving graph data", () => {
    const graphPath = join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json");
    const repository = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    const subject = createSubject();

    repository.upsertSubject(subject);
    const stored = JSON.parse(readFileSync(graphPath, "utf8")) as {
      graph: { subjects: Subject[] };
    };
    stored.graph.subjects[0] = { ...subject, displayName: "Tampered Subject" };
    writeFileSync(graphPath, `${JSON.stringify(stored)}\n`, "utf8");

    expect(() => new LocalJsonFileGraphRepository({ graphPath, now: () => now })).toThrow(
      "ReBAC graph state hash does not match the stored graph payload."
    );
  });

  it("rejects legacy raw graph snapshots without a hash envelope", () => {
    const graphPath = join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json");

    writeFileSync(graphPath, `${JSON.stringify({ subjects: [createSubject()] })}\n`, "utf8");

    expect(() => new LocalJsonFileGraphRepository({ graphPath, now: () => now })).toThrow(
      "ReBAC graph state must use the rebac-graph-state:v1 envelope."
    );
  });

  it("keeps local JSON graph persistence blocked from production readiness", () => {
    const repository = new LocalJsonFileGraphRepository({
      graphPath: join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json"),
      now: () => now
    });

    expect(repository.describePersistence()).toMatchObject({
      component: "graph",
      backend: "local_file",
      durable: false,
      immutable: false,
      capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback", "backup_restore"]
    });
  });

  it("appends local audit records with stored event hashes and reloads them in order", () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), "rebac-audit-")), "append-only-audit-events.jsonl");
    const repository = new LocalAppendOnlyAuditRepository({ auditPath, retentionDays: 365 });
    const [firstEvent, secondEvent] = createAuditEvents();

    const firstReceipt = repository.appendAuditEvent(firstEvent, now);
    const secondReceipt = repository.appendAuditEvent(secondEvent, "2026-05-21T17:01:00.000Z");

    expect(firstReceipt).toMatchObject({
      eventId: firstEvent.eventId,
      sequence: 1,
      eventHash: auditEventHash(firstEvent),
      backend: "local_file",
      location: "append-only-audit-events.jsonl",
      immutable: false
    });
    expect(secondReceipt).toMatchObject({
      eventId: secondEvent.eventId,
      sequence: 2,
      eventHash: auditEventHash(secondEvent),
      previousEventHash: auditEventHash(firstEvent)
    });

    const reopened = new LocalAppendOnlyAuditRepository({ auditPath, retentionDays: 365 });
    expect(reopened.listAuditEvents()).toEqual([firstEvent, secondEvent]);
    expect(reopened.verifyIntegrity("2026-05-21T17:02:00.000Z")).toMatchObject({
      status: "verified",
      eventCount: 2,
      firstEventId: firstEvent.eventId,
      lastEventId: secondEvent.eventId,
      findings: []
    });
    expect(() => reopened.appendAuditEvent(secondEvent, "2026-05-21T17:03:00.000Z")).toThrow(
      `Audit event ${secondEvent.eventId} has already been appended.`
    );
  });

  it("rejects out-of-order audit events before appending", () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), "rebac-audit-")), "append-only-audit-events.jsonl");
    const repository = new LocalAppendOnlyAuditRepository({ auditPath, retentionDays: 365 });
    const [firstEvent] = createAuditEvents();
    const orphanEvent = new AuditRecorder().record(
      {
        eventType: "resource.discovered",
        actor: "system:test",
        resourceId: "document:graph-plan",
        correlationId: "corr:orphan",
        payload: { resourceId: "document:graph-plan" }
      },
      "2026-05-21T17:01:00.000Z"
    );

    repository.appendAuditEvent(firstEvent, now);

    expect(() => repository.appendAuditEvent(orphanEvent, "2026-05-21T17:01:00.000Z")).toThrow(
      "Audit event previousEventHash does not match the current append-only tail."
    );
  });

  it("reports tampered local audit records and refuses to list them as trusted events", () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), "rebac-audit-")), "append-only-audit-events.jsonl");
    const repository = new LocalAppendOnlyAuditRepository({ auditPath, retentionDays: 365 });
    const [firstEvent] = createAuditEvents();

    repository.appendAuditEvent(firstEvent, now);
    const stored = readFirstJsonlRecord<{
      event: AuditEvent;
    }>(auditPath);
    stored.event.payload = { tampered: true };
    writeFileSync(auditPath, `${JSON.stringify(stored)}\n`, "utf8");

    const report = repository.verifyIntegrity("2026-05-21T17:02:00.000Z");

    expect(report.status).toBe("failed");
    expect(report.findings.map((finding) => finding.code)).toContain("AUDIT_RECORD_HASH_MISMATCH");
    expect(() => repository.listAuditEvents()).toThrow("Stored audit log integrity check failed");
  });

  it("reports malformed audit JSONL records as integrity findings", () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), "rebac-audit-")), "append-only-audit-events.jsonl");
    const repository = new LocalAppendOnlyAuditRepository({ auditPath, retentionDays: 365 });

    writeFileSync(auditPath, "{\"version\":\"rebac-audit-event-record:v1\"\n", "utf8");

    const report = repository.verifyIntegrity("2026-05-21T17:02:00.000Z");

    expect(report).toMatchObject({
      status: "failed",
      eventCount: 0,
      findings: [
        expect.objectContaining({
          code: "MALFORMED_RECORD",
          severity: "critical",
          message: "Stored audit record line 1 is not valid JSON."
        })
      ]
    });
    expect(() => repository.listAuditEvents()).toThrow("Stored audit log integrity check failed");
    expect(() => repository.appendAuditEvent(createAuditEvents()[0], now)).toThrow(
      "Stored audit log integrity check failed"
    );
  });

  it("describes local append-only audit persistence without claiming production immutability", () => {
    const repository = new LocalAppendOnlyAuditRepository({
      auditPath: join(mkdtempSync(join(tmpdir(), "rebac-audit-")), "append-only-audit-events.jsonl"),
      retentionDays: 365
    });

    expect(repository.describePersistence()).toMatchObject({
      component: "audit",
      backend: "local_file",
      durable: false,
      immutable: false,
      capabilities: ["audit_append", "audit_hash_chain", "audit_retention"],
      retentionDays: 365
    });
    expect(repository.describePersistence().capabilities).not.toContain("audit_immutability");
    expect(repository.describePersistence().capabilities).not.toContain("backup_restore");
  });

  it("persists job records to a local JSON job file and reloads them separately from graph and audit data", () => {
    const jobsPath = join(mkdtempSync(join(tmpdir(), "rebac-jobs-")), "job-state.json");
    const repository = new LocalJsonFileJobRepository({ jobsPath, now: () => now });
    const discoveryRun = createDiscoveryRun();
    const readinessReport = createEnforcementReadinessReport();
    const plan = createProvisioningPlan();
    const job = createProvisioningJob();
    const driftFinding = createDriftFinding();
    const reconciliationRun = createReconciliationRun(driftFinding);
    const decision = createDecision();

    repository.recordDiscoveryRun(discoveryRun);
    repository.recordEnforcementReadinessReport(readinessReport);
    repository.upsertProvisioningPlan(plan);
    repository.upsertProvisioningJob(job);
    repository.upsertDriftFinding(driftFinding);
    repository.recordReconciliationRun(reconciliationRun);
    repository.recordDecision(decision);
    const receipt = repository.flush(now);

    expect(receipt).toMatchObject({
      backend: "local_file",
      location: "job-state.json",
      jobsHash: expect.stringMatching(/^sha256:/),
      entityCounts: {
        discoveryRuns: 1,
        enforcementReadinessReports: 1,
        provisioningPlans: 1,
        provisioningJobs: 1,
        driftFindings: 1,
        reconciliationRuns: 1,
        decisions: 1
      }
    });

    const stored = JSON.parse(readFileSync(jobsPath, "utf8")) as {
      version: string;
      jobs: Record<string, unknown>;
    };
    expect(stored.version).toBe("rebac-job-state:v1");
    expect(stored.jobs).not.toHaveProperty("subjects");
    expect(stored.jobs).not.toHaveProperty("auditEvents");
    expect(stored.jobs).not.toHaveProperty("nativeGrants");

    const reopened = new LocalJsonFileJobRepository({ jobsPath, now: () => now });
    expect(reopened.listDiscoveryRuns({ connectorId: "mock", status: "completed" })).toEqual([discoveryRun]);
    expect(reopened.getEnforcementReadinessReport(readinessReport.id)).toEqual(readinessReport);
    expect(reopened.getProvisioningPlanByIdempotencyKey("idem:plan:alice-case-plan-read")).toEqual(plan);
    expect(reopened.getProvisioningJobByIdempotencyKey("idem:job:alice-case-plan-read")).toEqual(job);
    expect(reopened.getDriftFinding(driftFinding.id)).toEqual(driftFinding);
    expect(reopened.listDriftFindings({ severity: "high" })).toEqual([driftFinding]);
    expect(reopened.listReconciliationRuns()).toEqual([reconciliationRun]);
    expect(reopened.listDecisions()).toEqual([decision]);

    reopened.listProvisioningPlans()[0] = { ...plan, status: "approved" };
    expect(reopened.getProvisioningPlan(plan.id)?.status).toBe("planned");
  });

  it("updates local job records idempotently by stable identifiers", () => {
    const jobsPath = join(mkdtempSync(join(tmpdir(), "rebac-jobs-")), "job-state.json");
    const repository = new LocalJsonFileJobRepository({ jobsPath, now: () => now });
    const plan = createProvisioningPlan();
    const updatedPlan: ProvisioningPlan = {
      ...plan,
      status: "approved",
      updatedAt: "2026-05-21T18:00:00.000Z"
    };
    const decision = createDecision();
    const updatedDecision: DecisionResult = {
      ...decision,
      reasonCode: "ALLOW_RELATIONSHIP_PATH_REPLAY"
    };

    repository.upsertProvisioningPlan(plan);
    repository.upsertProvisioningPlan(updatedPlan);
    repository.recordDecision(decision);
    repository.recordDecision(updatedDecision);

    expect(repository.listProvisioningPlans()).toEqual([updatedPlan]);
    expect(repository.listDecisions()).toEqual([updatedDecision]);
    expect(new LocalJsonFileJobRepository({ jobsPath, now: () => now }).listProvisioningPlans()).toEqual([updatedPlan]);
  });

  it.each<{ name: string; createRepository: () => RebacJobRepository }>([
    {
      name: "in-memory",
      createRepository: () => new InMemoryRebacPersistenceRepository(createLocalEngineSeed())
    },
    {
      name: "local JSON",
      createRepository: () =>
        new LocalJsonFileJobRepository({
          jobsPath: join(mkdtempSync(join(tmpdir(), "rebac-jobs-")), "job-state.json"),
          now: () => now
        })
    }
  ])("rejects duplicate recorded $name job run identifiers", ({ createRepository }) => {
    const repository = createRepository();
    const discoveryRun = createDiscoveryRun();
    const readinessReport = createEnforcementReadinessReport();
    const reconciliationRun = createReconciliationRun(createDriftFinding());

    repository.recordDiscoveryRun(discoveryRun);
    repository.recordEnforcementReadinessReport(readinessReport);
    repository.recordReconciliationRun(reconciliationRun);

    expect(() => repository.recordDiscoveryRun({ ...discoveryRun, status: "failed" })).toThrow(
      `Discovery run ${discoveryRun.id} has already been recorded.`
    );
    expect(() => repository.recordEnforcementReadinessReport({ ...readinessReport, status: "ready" })).toThrow(
      `Enforcement readiness report ${readinessReport.id} has already been recorded.`
    );
    expect(() => repository.recordReconciliationRun({ ...reconciliationRun, status: "failed" })).toThrow(
      `Reconciliation run ${reconciliationRun.id} has already been recorded.`
    );
  });

  it("rejects tampered local job snapshots before serving job data", () => {
    const jobsPath = join(mkdtempSync(join(tmpdir(), "rebac-jobs-")), "job-state.json");
    const repository = new LocalJsonFileJobRepository({ jobsPath, now: () => now });
    const plan = createProvisioningPlan();

    repository.upsertProvisioningPlan(plan);
    const stored = JSON.parse(readFileSync(jobsPath, "utf8")) as {
      jobs: { provisioningPlans: ProvisioningPlan[] };
    };
    stored.jobs.provisioningPlans[0] = { ...plan, status: "approved" };
    writeFileSync(jobsPath, `${JSON.stringify(stored)}\n`, "utf8");

    expect(() => new LocalJsonFileJobRepository({ jobsPath, now: () => now })).toThrow(
      "ReBAC job state hash does not match the stored job payload."
    );
  });

  it("rejects unversioned local job snapshots before serving job data", () => {
    const jobsPath = join(mkdtempSync(join(tmpdir(), "rebac-jobs-")), "job-state.json");
    const repository = new LocalJsonFileJobRepository({ jobsPath, now: () => now });
    const plan = createProvisioningPlan();

    repository.upsertProvisioningPlan(plan);
    const stored = JSON.parse(readFileSync(jobsPath, "utf8")) as { version?: string };
    delete stored.version;
    writeFileSync(jobsPath, `${JSON.stringify(stored)}\n`, "utf8");

    expect(() => new LocalJsonFileJobRepository({ jobsPath, now: () => now })).toThrow(
      "ReBAC job state must use the rebac-job-state:v1 envelope."
    );
  });

  it("describes local JSON job persistence without claiming production durability", () => {
    const repository = new LocalJsonFileJobRepository({
      jobsPath: join(mkdtempSync(join(tmpdir(), "rebac-jobs-")), "job-state.json"),
      now: () => now
    });

    expect(repository.describePersistence()).toMatchObject({
      component: "job",
      backend: "local_file",
      durable: false,
      immutable: false,
      capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"]
    });
  });

  it("blocks proof-point persistence from production readiness", () => {
    const report = assessPersistenceReadiness(
      [
        {
          component: "graph",
          backend: "memory",
          durable: false,
          immutable: false,
          capabilities: ["graph_read", "graph_write", "relationship_query"],
          version: "persistence-backend:v1"
        },
        {
          component: "audit",
          backend: "local_file",
          durable: false,
          immutable: false,
          capabilities: ["audit_append", "audit_hash_chain"],
          retentionDays: 30,
          version: "persistence-backend:v1"
        },
        {
          component: "job",
          backend: "memory",
          durable: false,
          immutable: false,
          capabilities: ["job_enqueue", "idempotency_lookup"],
          version: "persistence-backend:v1"
        }
      ],
      now
    );

    expect(report.status).toBe("blocked");
    expect(failingCheckNames(report.checks)).toEqual([
      "graph_repository_durable",
      "graph_repository_capabilities",
      "audit_repository_durable",
      "audit_repository_capabilities",
      "audit_repository_immutable",
      "audit_repository_retention",
      "job_repository_durable",
      "job_repository_capabilities"
    ]);
  });

  it("marks external graph, append-only audit, and queue stores ready when required controls are present", () => {
    const descriptors: PersistenceBackendDescriptor[] = [
      {
        component: "graph",
        backend: "external_graph",
        durable: true,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
        location: "postgres://rebac-graph",
        version: "persistence-backend:v1"
      },
      {
        component: "audit",
        backend: "external_append_only_audit",
        durable: true,
        immutable: true,
        capabilities: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
        retentionDays: 2555,
        location: "worm://audit-ledger",
        version: "persistence-backend:v1"
      },
      {
        component: "job",
        backend: "external_queue",
        durable: true,
        immutable: false,
        capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
        location: "queue://rebac-jobs",
        version: "persistence-backend:v1"
      }
    ];

    const report = assessPersistenceReadiness(descriptors, now);

    expect(report.status).toBe("ready");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.requiredCapabilities.audit).toContain("audit_immutability");
  });

  it("marks a production persistence manifest ready when backend kinds, capabilities, and controls are evidenced", () => {
    const manifest = createProductionPersistenceManifest();
    const report = assessPersistenceDeploymentReadiness(manifest, now);

    expect(report.status).toBe("ready");
    expect(report.version).toBe("persistence-deployment-readiness:v1");
    expect(report.manifest).toEqual(manifest);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.checks.map((check) => check.name)).toContain("deployment_control_identityProviderBackedAccess");
    expect(report.checks.map((check) => check.name)).toContain("audit_repository_backend_kind");
  });

  it("blocks local proof-point repositories from production deployment readiness", () => {
    const localGraph = new LocalJsonFileGraphRepository({
      graphPath: join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json"),
      now: () => now
    });
    const localAudit = new LocalAppendOnlyAuditRepository({
      auditPath: join(mkdtempSync(join(tmpdir(), "rebac-audit-")), "append-only-audit-events.jsonl"),
      retentionDays: 365
    });
    const localJobs = new LocalJsonFileJobRepository({
      jobsPath: join(mkdtempSync(join(tmpdir(), "rebac-jobs-")), "job-state.json"),
      now: () => now
    });
    const manifest: PersistenceDeploymentManifest = {
      environment: "local_proof_point",
      generatedAt: now,
      descriptors: [
        localGraph.describePersistence(),
        localAudit.describePersistence(),
        localJobs.describePersistence()
      ],
      controls: createDeploymentControls(),
      evidenceRefs: ["reports/proof-point-validation.md"],
      version: "persistence-deployment-manifest:v1"
    };

    const report = assessPersistenceDeploymentReadiness(manifest, now);

    expect(report.status).toBe("blocked");
    expect(failingCheckNames(report.checks)).toEqual([
      "graph_repository_durable",
      "graph_repository_capabilities",
      "audit_repository_durable",
      "audit_repository_capabilities",
      "audit_repository_immutable",
      "job_repository_durable",
      "deployment_environment_production",
      "graph_repository_backend_kind",
      "audit_repository_backend_kind",
      "job_repository_backend_kind"
    ]);
  });

  it("blocks production persistence manifests without deployment control evidence", () => {
    const manifest: PersistenceDeploymentManifest = {
      ...createProductionPersistenceManifest(),
      controls: {
        ...createDeploymentControls(),
        backupRestoreTested: false
      },
      evidenceRefs: []
    };

    const report = assessPersistenceDeploymentReadiness(manifest, now);

    expect(report.status).toBe("blocked");
    expect(failingCheckNames(report.checks)).toEqual([
      "deployment_manifest_evidence_refs",
      "deployment_control_backupRestoreTested"
    ]);
  });

  it("allows deployment control requirements to be scoped for focused checks", () => {
    const manifest: PersistenceDeploymentManifest = {
      ...createProductionPersistenceManifest(),
      controls: {
        ...createDeploymentControls(),
        monitoringConfigured: false
      }
    };

    const report = assessPersistenceDeploymentReadiness(manifest, now, undefined, undefined, [
      "backupRestoreTested"
    ]);

    expect(report.status).toBe("ready");
    expect(report.checks.map((check) => check.name)).toContain("deployment_control_backupRestoreTested");
    expect(report.checks.map((check) => check.name)).not.toContain("deployment_control_monitoringConfigured");
  });

  it("does not pass deployment backend-kind checks with duplicate descriptors", () => {
    const manifest = createProductionPersistenceManifest();
    const graphDescriptor = manifest.descriptors.find((descriptor) => descriptor.component === "graph");

    if (!graphDescriptor) {
      throw new Error("Expected production manifest fixture to include a graph descriptor.");
    }

    const report = assessPersistenceDeploymentReadiness(
      {
        ...manifest,
        descriptors: [
          ...manifest.descriptors,
          {
            ...graphDescriptor,
            location: "external://graph/rebac-shadow"
          }
        ]
      },
      now
    );

    expect(report.status).toBe("blocked");
    expect(failingCheckNames(report.checks)).toEqual([
      "graph_repository_descriptor_unique",
      "graph_repository_backend_kind"
    ]);
    expect(report.checks.find((check) => check.name === "graph_repository_backend_kind")).toMatchObject({
      status: "fail",
      evidence: { requiredBackend: "external_graph", actualBackends: ["external_graph", "external_graph"] }
    });
  });

  it("blocks duplicate persistence descriptors for the same component", () => {
    const descriptors: PersistenceBackendDescriptor[] = [
      {
        component: "graph",
        backend: "external_graph",
        durable: true,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
        location: "postgres://rebac-graph-primary",
        version: "persistence-backend:v1"
      },
      {
        component: "graph",
        backend: "external_graph",
        durable: true,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
        location: "postgres://rebac-graph-shadow",
        version: "persistence-backend:v1"
      },
      {
        component: "audit",
        backend: "external_append_only_audit",
        durable: true,
        immutable: true,
        capabilities: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
        retentionDays: 2555,
        location: "worm://audit-ledger",
        version: "persistence-backend:v1"
      },
      {
        component: "job",
        backend: "external_queue",
        durable: true,
        immutable: false,
        capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
        location: "queue://rebac-jobs",
        version: "persistence-backend:v1"
      }
    ];

    const report = assessPersistenceReadiness(descriptors, now);

    expect(report.status).toBe("blocked");
    expect(failingCheckNames(report.checks)).toEqual(["graph_repository_descriptor_unique"]);
    expect(report.checks.find((check) => check.name === "graph_repository_descriptor_unique")).toMatchObject({
      component: "graph",
      evidence: { count: 2, backends: ["external_graph", "external_graph"] }
    });
    expect(report.descriptors).toHaveLength(4);
  });
});

function failingCheckNames(checks: Array<{ name: string; status: string }>): string[] {
  return checks.filter((check) => check.status === "fail").map((check) => check.name);
}

function readFirstJsonlRecord<T>(path: string): T {
  const line = readFileSync(path, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    throw new Error(`Expected ${path} to contain a JSONL record.`);
  }

  return JSON.parse(line) as T;
}

function createProductionPersistenceManifest(): PersistenceDeploymentManifest {
  return {
    environment: "production",
    generatedAt: now,
    descriptors: [
      {
        component: "graph",
        backend: "external_graph",
        durable: true,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
        location: "external://graph/rebac-primary",
        version: "persistence-backend:v1"
      },
      {
        component: "audit",
        backend: "external_append_only_audit",
        durable: true,
        immutable: true,
        capabilities: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
        retentionDays: 2555,
        location: "external://audit/rebac-ledger",
        version: "persistence-backend:v1"
      },
      {
        component: "job",
        backend: "external_queue",
        durable: true,
        immutable: false,
        capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
        location: "external://queue/rebac-jobs",
        version: "persistence-backend:v1"
      }
    ],
    controls: createDeploymentControls(),
    evidenceRefs: [
      "evidence/persistence/graph-backup-restore.json",
      "evidence/persistence/audit-retention.json",
      "evidence/persistence/job-queue-replay.json"
    ],
    version: "persistence-deployment-manifest:v1"
  };
}

function createDeploymentControls(): PersistenceDeploymentManifest["controls"] {
  return {
    identityProviderBackedAccess: true,
    operatorAuthorization: true,
    secretsExternalized: true,
    backupRestoreTested: true,
    changeApprovalRequired: true,
    monitoringConfigured: true,
    migrationPlanReviewed: true
  };
}

function createSubject(): Subject {
  return {
    id: "user:bob",
    type: "user",
    displayName: "Bob Example",
    sourceSystem: "mock",
    lifecycleState: "active",
    identifiers: { email: "bob@example.invalid" },
    version: "subject:v1",
    createdAt: now
  };
}

function createResource(): Resource {
  return {
    id: "document:graph-plan",
    type: "document",
    displayName: "Graph Plan",
    sourceSystem: "mock",
    ownerId: "user:bob",
    dataStewardId: "user:bob",
    technicalOwnerId: "user:bob",
    classification: "controlled",
    lifecycleState: "active",
    version: "resource:v1",
    createdAt: now
  };
}

function createRelationship(): RelationshipTuple {
  return {
    id: "relationship:bob-graph-plan-reader",
    subjectId: "user:bob",
    relation: "reader",
    objectId: "document:graph-plan",
    sourceSystem: "mock",
    assertedAt: now,
    assertedBy: "system:test",
    status: "active",
    version: "relationship:v1",
    createdAt: now
  };
}

function createAuditEvents(): [AuditEvent, AuditEvent] {
  const recorder = new AuditRecorder();
  const firstEvent = recorder.record(
    {
      eventType: "subject.created",
      actor: "system:test",
      subjectId: "user:bob",
      correlationId: "corr:audit:first",
      payload: { subjectId: "user:bob" }
    },
    now
  );
  const secondEvent = recorder.record(
    {
      eventType: "relationship.created",
      actor: "system:test",
      subjectId: "user:bob",
      resourceId: "document:graph-plan",
      correlationId: "corr:audit:second",
      payload: { relationshipId: "relationship:bob-graph-plan-reader" }
    },
    "2026-05-21T17:01:00.000Z"
  );

  return [firstEvent, secondEvent];
}

function createDiscoveryRun(): DiscoveryRun {
  return {
    id: "discovery-run:mock:one",
    connectorId: "mock",
    mode: "read_only",
    status: "completed",
    startedAt: now,
    completedAt: "2026-05-21T17:01:00.000Z",
    counts: {
      subjects: 1,
      resources: 1,
      relationships: 1,
      nativeGrants: 1,
      warnings: 0
    },
    warnings: [],
    evidence: {
      readOnly: true,
      schemas: ["subject", "resource", "relationship", "native-grant"],
      connectorCapabilities: ["discovery", "read_current_access"],
      nativeAccessReadback: true
    },
    auditEventIds: ["evt:discovery"],
    version: "discovery-run:v1",
    createdAt: now
  };
}

function createEnforcementReadinessReport(): EnforcementReadinessReport {
  return {
    id: "enforcement-readiness:mock",
    connectorId: "mock",
    provider: "mock",
    tenantBoundary: "synthetic",
    mode: "enforcement",
    status: "blocked",
    checkedAt: now,
    control: {
      syntheticOnly: true,
      liveProviderWrites: false,
      incidentMode: false,
      breakGlass: false
    },
    checks: [
      {
        name: "live_provider_writes_blocked",
        status: "pass",
        message: "Synthetic connector remains isolated from live provider writes."
      }
    ],
    requiredApproverRole: "access-admin",
    changeTicketPattern: "^CHG-[0-9]+$",
    liveProviderWritesAllowed: false,
    auditEventIds: ["evt:readiness"],
    version: "enforcement-readiness:v1",
    createdAt: now
  };
}

function createDriftFinding(): DriftFinding {
  return {
    id: "drift:alice-case-plan-read",
    resourceId: "document:case-plan",
    subjectId: "user:alice",
    nativeAccess: "read",
    intendedAccess: "none",
    severity: "high",
    detectedAt: now,
    sourceConnectorId: "mock",
    recommendedAction: "revoke",
    status: "open",
    version: "drift-finding:v1",
    createdAt: now
  };
}

function createReconciliationRun(finding: DriftFinding): ReconciliationRun {
  return {
    id: "reconciliation-run:mock:one",
    connectorId: "mock",
    mode: "dry_run",
    dryRun: true,
    status: "completed",
    findings: [finding],
    counts: {
      findings: 1,
      highOrCritical: 1
    },
    auditEventIds: ["evt:reconciliation"],
    completedAt: "2026-05-21T17:02:00.000Z",
    version: "reconciliation-run:v1",
    createdAt: now
  };
}

function createDecision(): DecisionResult {
  return {
    decisionId: "decision:alice-case-plan-read",
    decision: "allow",
    subjectId: "user:alice",
    action: "read",
    resourceId: "document:case-plan",
    reasonCode: "ALLOW_RELATIONSHIP_PATH",
    policyVersion: "policy:v1",
    relationshipVersion: "relationship:v1",
    relationshipPath: [
      {
        subjectId: "user:alice",
        relation: "reader",
        objectId: "document:case-plan"
      }
    ],
    constraints: {},
    evaluatedAt: now
  };
}

function createNativeGrant(): NativeGrant {
  return {
    id: "native-grant:bob-graph-plan-read",
    targetPlatform: "mock",
    targetObjectId: "document:graph-plan",
    subjectId: "user:bob",
    principalType: "user",
    nativePermission: "read",
    grantType: "direct",
    sourceConnectorId: "mock",
    status: "observed",
    observedAt: now,
    version: "native-grant:v1",
    createdAt: now
  };
}

function createProvisioningPlan(): ProvisioningPlan {
  return {
    id: "plan:alice-case-plan-read",
    idempotencyKey: "idem:plan:alice-case-plan-read",
    connectorId: "mock",
    subjectId: "user:alice",
    resourceId: "document:case-plan",
    action: "read",
    mode: "dry_run",
    status: "planned",
    actions: [],
    version: "provisioning-plan:v1",
    createdAt: now
  };
}

function createProvisioningJob(): ProvisioningJob {
  return {
    id: "job:alice-case-plan-read",
    planId: "plan:alice-case-plan-read",
    connectorId: "mock",
    mode: "dry_run",
    dryRun: true,
    status: "queued",
    approverId: "system:dry-run",
    idempotencyKey: "idem:job:alice-case-plan-read",
    actionResults: [],
    verification: {
      status: "pending",
      method: "readback",
      expectedState: { subjectId: "user:alice", resourceId: "document:case-plan", action: "read" }
    },
    auditEventIds: [],
    startedAt: now,
    version: "provisioning-job:v1",
    createdAt: now
  };
}
