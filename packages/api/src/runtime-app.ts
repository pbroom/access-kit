import type {
  AdminAuthorizationDescriptor,
  AuditEventRepository,
  AuditRecorder,
  ConnectorAdapter,
  EvidencePackageRepository,
  InMemoryRebacStore,
  PersistenceDegradationReceipt,
  ProductionJobQueueAdapter,
  RebacDecisionEngine,
  RebacGraphRepository,
  RebacJobRepository,
  RebacSeedData,
  RebacStateRepository
} from "@access-kit/core";

export interface RebacLocalAppOptions {
  now?: () => string;
  actor?: string;
  seed?: RebacSeedData;
  adminAuthorization?: AdminAuthorizationDescriptor;
  persistence?: RebacRuntimePersistence;
  graphRepository?: RebacGraphRepository;
  jobRepository?: RebacJobRepository;
  jobQueue?: ProductionJobQueueAdapter;
  stateRepository?: RebacStateRepository;
  auditRepository?: AuditEventRepository;
  evidenceRepository?: EvidencePackageRepository;
}

export interface RebacRuntimePersistence {
  graphRepository?: RebacGraphRepository;
  jobRepository?: RebacJobRepository;
  jobQueue?: ProductionJobQueueAdapter;
  stateRepository?: RebacStateRepository;
  auditRepository?: AuditEventRepository;
  evidenceRepository?: EvidencePackageRepository;
  waitForPendingWrites?(): Promise<void>;
  close?(): Promise<void>;
}

export type RebacPersistenceDegradation = PersistenceDegradationReceipt;

export class RebacLocalAppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface RebacLocalApp {
  store: InMemoryRebacStore;
  engine: RebacDecisionEngine;
  auditRecorder: AuditRecorder;
  persistence: RebacRuntimePersistence;
  persistenceDegradations: RebacPersistenceDegradation[];
  graphRepository?: RebacGraphRepository;
  jobRepository?: RebacJobRepository;
  jobQueue?: ProductionJobQueueAdapter;
  stateRepository?: RebacStateRepository;
  auditRepository?: AuditEventRepository;
  evidenceRepository?: EvidencePackageRepository;
  adminAuthorization: AdminAuthorizationDescriptor;
  connectors: Map<string, ConnectorAdapter>;
  now: () => string;
  actor: string;
}

export function normalizeRuntimePersistence(options: RebacLocalAppOptions): RebacRuntimePersistence {
  const jobQueue = options.persistence?.jobQueue ?? options.jobQueue;

  return {
    graphRepository: options.persistence?.graphRepository ?? options.graphRepository,
    jobRepository: options.persistence?.jobRepository ?? options.jobRepository ?? jobQueue,
    jobQueue,
    stateRepository: options.persistence?.stateRepository ?? options.stateRepository,
    auditRepository: options.persistence?.auditRepository ?? options.auditRepository,
    evidenceRepository: options.persistence?.evidenceRepository ?? options.evidenceRepository,
    waitForPendingWrites: options.persistence?.waitForPendingWrites,
    close: options.persistence?.close
  };
}
