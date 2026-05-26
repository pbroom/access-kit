import type {
  EvidenceExport,
  JsonRecord,
  ProductionJobQueueAdapter,
  ProductionQueuedJob,
  ProvisioningMode
} from "@access-kit/core";
import {
  createProvisioningJob,
  createRevocationPlan,
  exportEvidence,
  runReconciliation,
  syncConnector,
  type RebacLocalApp
} from "./local-app.js";

export interface DrainQueuedJobOptions {
  queue?: ProductionJobQueueAdapter;
  workerId?: string;
  reservedAt?: string;
}

export interface DrainQueuedJobResult {
  status: "idle" | "completed" | "failed" | "dead_lettered";
  queueJob?: ProductionQueuedJob;
  result?: unknown;
  error?: string;
}

export async function drainNextQueuedJob(
  app: RebacLocalApp,
  options: DrainQueuedJobOptions = {}
): Promise<DrainQueuedJobResult> {
  const queue = options.queue ?? app.jobQueue;

  if (!queue) {
    return { status: "idle" };
  }

  const workerId = options.workerId ?? "worker:local-runtime";
  const reserved = queue.reserveNextJob({
    workerId,
    reservedAt: options.reservedAt ?? app.now()
  });

  if (!reserved) {
    return { status: "idle" };
  }

  try {
    const result = await executeQueuedJob(app, reserved);
    const completed = queue.completeJob(reserved.id, {
      workerId,
      completedAt: app.now()
    });
    return { status: "completed", queueJob: completed, result };
  } catch (error) {
    const failed = queue.recordJobFailure(reserved.id, {
      workerId,
      failedAt: app.now(),
      error: errorMessage(error)
    });
    return {
      status: failed.status === "dead_lettered" ? "dead_lettered" : "failed",
      queueJob: failed,
      error: errorMessage(error)
    };
  }
}

async function executeQueuedJob(app: RebacLocalApp, job: ProductionQueuedJob): Promise<unknown> {
  switch (job.kind) {
    case "discovery":
      return syncConnector(app, connectorId(job), "read_only");
    case "reconciliation":
      return runReconciliation(app, connectorId(job));
    case "provisioning":
      return runProvisioningJob(app, job);
    case "revocation":
      return runRevocationJob(app, job);
    case "evidence":
      return exportEvidence(app, readControls(job.payload), readEvidenceFormat(job.payload));
    default:
      return assertNever(job.kind);
  }
}

function runProvisioningJob(app: RebacLocalApp, job: ProductionQueuedJob): Promise<unknown> {
  return createProvisioningJob(app, {
    planId: requiredString(job.payload, "planId", `Queued provisioning job ${job.id}`),
    approverId: optionalString(job.payload, "approverId") ?? job.approval?.approverId ?? app.actor,
    idempotencyKey: optionalString(job.payload, "jobIdempotencyKey") ?? optionalString(job.payload, "idempotencyKey") ?? job.idempotencyKey,
    mode: readProvisioningMode(job.payload),
    approval: job.approval,
    control: job.control
  });
}

async function runRevocationJob(app: RebacLocalApp, job: ProductionQueuedJob): Promise<unknown> {
  const planId = optionalString(job.payload, "planId");

  if (planId) {
    return createProvisioningJob(app, {
      planId,
      approverId: optionalString(job.payload, "approverId") ?? job.approval?.approverId ?? app.actor,
      idempotencyKey: optionalString(job.payload, "jobIdempotencyKey") ?? `${job.idempotencyKey}:job`,
      mode: readProvisioningMode(job.payload),
      approval: job.approval,
      control: job.control
    });
  }

  const plan = await createRevocationPlan(
    app,
    requiredString(job.payload, "nativeGrantId", `Queued revocation job ${job.id}`),
    connectorId(job),
    {
      mode: readProvisioningMode(job.payload) ?? "dry_run",
      approval: job.approval,
      control: job.control,
      readinessReportId: job.readinessReportId
    },
    optionalString(job.payload, "planIdempotencyKey") ?? `${job.idempotencyKey}:plan`
  );

  return createProvisioningJob(app, {
    planId: plan.id,
    approverId: optionalString(job.payload, "approverId") ?? job.approval?.approverId ?? app.actor,
    idempotencyKey: optionalString(job.payload, "jobIdempotencyKey") ?? `${job.idempotencyKey}:job`,
    mode: plan.mode,
    approval: job.approval,
    control: job.control
  });
}

function connectorId(job: ProductionQueuedJob): string {
  return job.connectorId;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported queued job kind: ${String(value)}`);
}

function readProvisioningMode(payload: JsonRecord): ProvisioningMode | undefined {
  const mode = optionalString(payload, "mode");

  if (mode === "dry_run" || mode === "enforcement") {
    return mode;
  }

  return undefined;
}

function readEvidenceFormat(payload: JsonRecord): EvidenceExport["format"] {
  const format = optionalString(payload, "format");

  if (format === "json" || format === "zip" || format === "markdown") {
    return format;
  }

  return "json";
}

function readControls(payload: JsonRecord): string[] {
  const controls = payload.controls;

  if (Array.isArray(controls) && controls.every((control): control is string => typeof control === "string")) {
    return controls;
  }

  return [];
}

function requiredString(payload: JsonRecord, key: string, label: string): string {
  const value = optionalString(payload, key);

  if (!value) {
    throw new Error(`${label} payload requires ${key}.`);
  }

  return value;
}

function optionalString(payload: JsonRecord, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queued job execution failure.";
}
