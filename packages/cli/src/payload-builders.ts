import { readFile } from "node:fs/promises";

import { CliConfigurationError } from "./errors.js";
import type { CliContext } from "./runtime-options.js";

interface ProvisioningPayloadOptions {
  mode?: "dry_run" | "enforcement";
  approver?: string;
  changeTicket?: string;
  reason?: string;
  syntheticOnly?: boolean;
  incidentMode?: boolean;
  breakGlass?: boolean;
  readinessReport?: string;
}

interface EmergencyRevokePayloadOptions {
  connector?: string;
  approver?: string;
  changeTicket?: string;
  readinessReport?: string;
  reason?: string;
  confirmRevoke?: boolean;
}

export function buildProvisioningJobPayload(options: ProvisioningPayloadOptions, context: CliContext): Record<string, unknown> {
  const mode = options.mode ?? "dry_run";

  if (mode === "dry_run") {
    return {
      mode,
      dryRun: true
    };
  }

  if (mode !== "enforcement") {
    throw new Error("mode must be dry_run or enforcement");
  }

  return {
    mode,
    dryRun: false,
    approval: {
      decision: "approved",
      approverId: options.approver ?? "user:cli-operator",
      changeTicket: required(options.changeTicket, "change-ticket"),
      approvedAt: context.now(),
      reason: options.reason
    },
    control: {
      syntheticOnly: options.syntheticOnly === true,
      // The CLI keeps live writes disabled until a runbook-backed provider-write flag exists.
      liveProviderWrites: false,
      incidentMode: options.incidentMode === true,
      breakGlass: options.breakGlass === true
    }
  };
}

export function buildProvisioningExecutionPayload(options: ProvisioningPayloadOptions, context: CliContext): Record<string, unknown> {
  const mode = options.mode ?? "dry_run";

  if (mode === "dry_run") {
    return {
      mode,
      dryRun: true
    };
  }

  if (mode !== "enforcement") {
    throw new Error("mode must be dry_run or enforcement");
  }

  const approverId = options.approver ?? "user:cli-operator";
  return {
    mode,
    dryRun: false,
    approval: {
      decision: "approved",
      approverId,
      changeTicket: required(options.changeTicket, "change-ticket"),
      approvedAt: context.now(),
      reason: options.reason
    },
    readinessReportId: required(options.readinessReport, "readiness-report"),
    control: {
      syntheticOnly: options.syntheticOnly === true,
      liveProviderWrites: false,
      incidentMode: options.incidentMode === true,
      breakGlass: options.breakGlass === true
    }
  };
}

export function buildEmergencyRevokePayload(
  options: EmergencyRevokePayloadOptions,
  context: CliContext,
  grantId: string
): Record<string, unknown> & { approval: Record<string, unknown> } {
  if (options.confirmRevoke !== true) {
    throw new CliConfigurationError("emergency revoke requires --confirm-revoke");
  }

  const approval = {
    decision: "approved",
    approverId: required(options.approver, "approver"),
    changeTicket: required(options.changeTicket, "change-ticket"),
    approvedAt: context.now(),
    reason: required(options.reason, "reason")
  };

  return {
    grantId,
    connectorId: required(options.connector, "connector"),
    action: "revoke",
    mode: "enforcement",
    dryRun: false,
    approval,
    readinessReportId: required(options.readinessReport, "readiness-report"),
    control: {
      syntheticOnly: true,
      liveProviderWrites: false,
      incidentMode: false,
      breakGlass: false
    }
  };
}

export async function readEvidencePackageFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read evidence package ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
