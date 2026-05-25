import type {
  AuditEventRepository,
  AuditRecorder,
  ConnectorAdapter,
  EvidencePackageRepository,
  InMemoryRebacStore,
  PersistenceDegradationReceipt,
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
  persistence?: RebacRuntimePersistence;
  graphRepository?: RebacGraphRepository;
  jobRepository?: RebacJobRepository;
  stateRepository?: RebacStateRepository;
  auditRepository?: AuditEventRepository;
  evidenceRepository?: EvidencePackageRepository;
}

export interface RebacRuntimePersistence {
  graphRepository?: RebacGraphRepository;
  jobRepository?: RebacJobRepository;
  stateRepository?: RebacStateRepository;
  auditRepository?: AuditEventRepository;
  evidenceRepository?: EvidencePackageRepository;
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
  stateRepository?: RebacStateRepository;
  auditRepository?: AuditEventRepository;
  evidenceRepository?: EvidencePackageRepository;
  connectors: Map<string, ConnectorAdapter>;
  now: () => string;
  actor: string;
}

export function normalizeRuntimePersistence(options: RebacLocalAppOptions): RebacRuntimePersistence {
  return {
    graphRepository: options.persistence?.graphRepository ?? options.graphRepository,
    jobRepository: options.persistence?.jobRepository ?? options.jobRepository,
    stateRepository: options.persistence?.stateRepository ?? options.stateRepository,
    auditRepository: options.persistence?.auditRepository ?? options.auditRepository,
    evidenceRepository: options.persistence?.evidenceRepository ?? options.evidenceRepository
  };
}
