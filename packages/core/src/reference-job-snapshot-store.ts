import type { CanonicalId, JsonRecord } from "./domain.js";
import type { RebacJobSnapshot } from "./persistence.js";
import {
  assertObjectArrayFields,
  assertStoredPayloadHash,
  countJobEntities,
  normalizeJobSnapshot,
  stableHash
} from "./repository-envelopes.js";
import type { RebacJobStorageReceipt } from "./repositories.js";
import type { ExternalSnapshotStore, ReferenceRepositoryBackupMetadata } from "./reference-repositories.js";
import {
  assertEvidenceTenantBoundary,
  assertNoSecretMaterial,
  assertReportTenantBoundary,
  clone
} from "./reference-repository-security-utils.js";

export interface ReferenceJobSnapshotStoreRecord {
  version: string;
  storedAt: string;
  tenantBoundary: string;
  jobsHash: string;
  jobs: RebacJobSnapshot;
  backupMetadata: ReferenceRepositoryBackupMetadata[];
}

export interface ReferenceJobSnapshotStoreFields {
  storedAt: string;
  tenantBoundary: string;
  jobsHash: string;
  jobs: RebacJobSnapshot;
  entityCounts: RebacJobStorageReceipt["entityCounts"];
  backupMetadata: ReferenceRepositoryBackupMetadata[];
}

export interface ReferenceJobSnapshotStoreOptions<TRecord extends ReferenceJobSnapshotStoreRecord> {
  store: ExternalSnapshotStore<TRecord>;
  tenantBoundary: string;
  component: "connector_state" | "job";
  location: string;
  recordVersion: TRecord["version"];
  recordLabel: string;
  payloadLabel: string;
  snapshotLabel: string;
  backupMissingLabel: string;
  validateRecord?: (record: TRecord) => TRecord;
}

export interface ReferenceJobSnapshotBackupMetadataOptions {
  id: CanonicalId;
  createdAt: string;
  snapshotHash: string;
  entityCounts: Record<string, number>;
}

const jobSnapshotFields = [
  "discoveryRuns",
  "enforcementReadinessReports",
  "provisioningPlans",
  "provisioningJobs",
  "driftFindings",
  "accessReviewCampaigns",
  "governanceFindings",
  "exceptionRequests",
  "reconciliationRuns",
  "decisions"
] as const;

export class ReferenceJobSnapshotStore<TRecord extends ReferenceJobSnapshotStoreRecord> {
  readonly #store: ExternalSnapshotStore<TRecord>;
  readonly #tenantBoundary: string;
  readonly #component: "connector_state" | "job";
  readonly #location: string;
  readonly #recordVersion: TRecord["version"];
  readonly #recordLabel: string;
  readonly #payloadLabel: string;
  readonly #snapshotLabel: string;
  readonly #backupMissingLabel: string;
  readonly #validateRecord: (record: TRecord) => TRecord;

  constructor(options: ReferenceJobSnapshotStoreOptions<TRecord>) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#component = options.component;
    this.#location = options.location;
    this.#recordVersion = options.recordVersion;
    this.#recordLabel = options.recordLabel;
    this.#payloadLabel = options.payloadLabel;
    this.#snapshotLabel = options.snapshotLabel;
    this.#backupMissingLabel = options.backupMissingLabel;
    this.#validateRecord = options.validateRecord ?? ((record) => record);
  }

  readCurrent(): TRecord | undefined {
    const stored = this.#store.readCurrent();

    if (!stored) {
      return undefined;
    }

    return this.#validateStoredRecord(stored);
  }

  readBackup(id: CanonicalId): TRecord {
    const backup = this.#store.readBackup(id);

    if (!backup) {
      throw new Error(`${this.#backupMissingLabel} ${id} does not exist.`);
    }

    return this.#validateStoredRecord(backup);
  }

  writeCurrent(record: TRecord): void {
    this.#store.writeCurrent(record);
  }

  compareExchangeCurrent(expected: TRecord | undefined, record: TRecord): boolean {
    return this.#store.compareExchangeCurrent(expected, record);
  }

  writeBackup(id: CanonicalId, record: TRecord): void {
    this.#store.writeBackup(id, record);
  }

  createSnapshotFields(
    storedAt: string,
    snapshot: RebacJobSnapshot,
    backupMetadata: ReferenceRepositoryBackupMetadata[]
  ): ReferenceJobSnapshotStoreFields {
    const jobs = normalizeJobSnapshot(snapshot);
    assertJobTenantBoundary(jobs, this.#tenantBoundary);
    assertNoSecretMaterial(jobs, this.#snapshotLabel);
    return {
      storedAt,
      tenantBoundary: this.#tenantBoundary,
      jobsHash: `sha256:${stableHash(jobs)}`,
      jobs,
      entityCounts: countJobEntities(jobs),
      backupMetadata: clone(backupMetadata)
    };
  }

  createBackupMetadata(
    options: ReferenceJobSnapshotBackupMetadataOptions
  ): ReferenceRepositoryBackupMetadata {
    return {
      id: options.id,
      component: this.#component,
      createdAt: options.createdAt,
      location: `${this.#location}#backup:${options.id}`,
      snapshotHash: options.snapshotHash,
      tenantBoundary: this.#tenantBoundary,
      entityCounts: options.entityCounts,
      version: "production-repository-backup:v1"
    };
  }

  #validateStoredRecord(record: TRecord): TRecord {
    if (record.version !== this.#recordVersion) {
      throw new Error(`${this.#recordLabel} must use the ${this.#recordVersion} envelope.`);
    }
    if (record.tenantBoundary !== this.#tenantBoundary) {
      throw new Error(`${this.#recordLabel} tenant boundary does not match the configured tenant boundary.`);
    }
    assertObjectArrayFields(record.jobs, this.#payloadLabel, jobSnapshotFields);
    assertStoredPayloadHash(
      record.jobs,
      record.jobsHash,
      `${this.#recordLabel} hash does not match the stored job payload.`
    );
    assertJobTenantBoundary(record.jobs, this.#tenantBoundary);
    assertNoSecretMaterial(record.jobs, this.#snapshotLabel);
    return this.#validateRecord({
      ...record,
      jobs: normalizeJobSnapshot(record.jobs),
      backupMetadata: clone(record.backupMetadata ?? [])
    });
  }
}

export function emptyReferenceJobSnapshot(): RebacJobSnapshot {
  return {
    discoveryRuns: [],
    enforcementReadinessReports: [],
    provisioningPlans: [],
    provisioningJobs: [],
    driftFindings: [],
    accessReviewCampaigns: [],
    governanceFindings: [],
    exceptionRequests: [],
    reconciliationRuns: [],
    decisions: []
  };
}

function assertJobTenantBoundary(jobs: RebacJobSnapshot, tenantBoundary: string): void {
  for (const run of jobs.discoveryRuns) {
    assertEvidenceTenantBoundary(run.evidence as unknown as JsonRecord, tenantBoundary, `Discovery run ${run.id}`);
  }
  for (const report of jobs.enforcementReadinessReports) {
    assertReportTenantBoundary(report, tenantBoundary);
  }
}
