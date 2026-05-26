import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Command } from "commander";

export type CliApiSurface = `${"DELETE" | "GET" | "POST" | "PUT"} /v1/${string}` | "local";

export interface CliCommandSpec {
  path: string;
  description: string;
  apiSurface: CliApiSurface;
}

export interface CliProfile {
  apiUrl?: string;
  apiKeyEnv?: string;
}

export interface CliProfileConfig {
  profiles?: Record<string, CliProfile>;
}

export const CLI_EXIT_CODES = {
  success: 0,
  apiFailure: 70,
  configuration: 78
} as const;

export type CliExitCode = typeof CLI_EXIT_CODES[keyof typeof CLI_EXIT_CODES];

export interface CliRuntimeOptions {
  apiUrl: string;
  apiKey?: string;
  preview: boolean;
  diff: boolean;
}

export interface CliOptions {
  apiUrl?: string;
  apiKeyEnv?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  profiles?: Record<string, CliProfile>;
  writeText?: (value: string) => void;
  writeJson?: (value: unknown) => void;
  now?: () => string;
}

export const CLI_COMMANDS: CliCommandSpec[] = [
  { path: "subject sync", description: "Sync subjects from a connector.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "subject get", description: "Inspect a canonical subject.", apiSurface: "GET /v1/subjects/{id}" },
  { path: "subject access", description: "Explain current subject access.", apiSurface: "GET /v1/subjects/{id}/access" },
  // Discovery-oriented commands share the connector sync endpoint until provider-specific inventory endpoints land.
  { path: "resource discover", description: "Discover resources from a connector.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "resource get", description: "Inspect a canonical resource.", apiSurface: "GET /v1/resources/{id}" },
  { path: "resource access", description: "Explain resource access paths.", apiSurface: "GET /v1/resources/{id}/access" },
  { path: "resource native-access", description: "Inspect observed native grants for a resource.", apiSurface: "GET /v1/resources/{id}/native-access" },
  { path: "relation set", description: "Create or replace a relationship tuple.", apiSurface: "PUT /v1/relationships" },
  { path: "relation delete", description: "Delete a relationship tuple.", apiSurface: "DELETE /v1/relationships" },
  { path: "relation path", description: "Show relationship paths between subject and resource.", apiSurface: "GET /v1/relationships" },
  { path: "policy validate", description: "Validate a policy model.", apiSurface: "POST /v1/policies/{id}/validate" },
  { path: "policy test", description: "Run policy proof-point tests.", apiSurface: "POST /v1/policies/{id}/validate" },
  { path: "policy publish", description: "Publish an approved policy model.", apiSurface: "POST /v1/policies/{id}/publish" },
  { path: "check", description: "Run a fast allow/deny decision.", apiSurface: "POST /v1/decision/check" },
  { path: "explain", description: "Run an explainable decision.", apiSurface: "POST /v1/decision/explain" },
  { path: "provision plan", description: "Create a dry-run or controlled synthetic enforcement provisioning plan.", apiSurface: "POST /v1/provisioning/plans" },
  { path: "provision apply", description: "Run a dry-run or controlled synthetic enforcement provisioning job for a plan.", apiSurface: "POST /v1/provisioning/jobs" },
  { path: "provision revoke", description: "Create a revocation plan.", apiSurface: "POST /v1/provisioning/plans" },
  { path: "reconcile run", description: "Run reconciliation for a connector.", apiSurface: "POST /v1/reconciliation/run" },
  { path: "reconcile findings", description: "List drift findings.", apiSurface: "GET /v1/reconciliation/findings" },
  { path: "reconcile remediate", description: "Plan approved dry-run remediation for a drift finding.", apiSurface: "POST /v1/reconciliation/findings/{id}/remediation" },
  { path: "discovery runs", description: "List read-only connector discovery runs.", apiSurface: "GET /v1/discovery/runs" },
  { path: "audit search", description: "Search append-only audit events.", apiSurface: "GET /v1/audit/events" },
  { path: "audit integrity", description: "Verify append-only audit hash-chain integrity.", apiSurface: "GET /v1/audit/integrity" },
  { path: "audit export", description: "Export SIEM-ready audit events.", apiSurface: "GET /v1/audit/export" },
  { path: "evidence export", description: "Export ATO evidence.", apiSurface: "GET /v1/evidence/export" },
  { path: "evidence verify", description: "Verify an exported signed evidence package.", apiSurface: "POST /v1/evidence/verify" },
  { path: "connector list", description: "List connectors and capabilities.", apiSurface: "GET /v1/connectors" },
  { path: "connector test", description: "Test connector health and permissions.", apiSurface: "POST /v1/connectors/{id}/test" },
  { path: "connector readiness", description: "Check controlled-enforcement readiness for a connector.", apiSurface: "POST /v1/connectors/{id}/enforcement-readiness" },
  { path: "connector sync", description: "Run connector discovery or reconciliation.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "completion", description: "Print shell completion for bash, zsh, or fish.", apiSurface: "local" }
];

export function buildCli(options: CliOptions = {}): Command {
  const program = new Command();
  program
    .name("rebac")
    .description("Operator CLI for the Access Kit ReBAC control plane.")
    .version("0.1.0")
    .option("--api-url <url>", "ReBAC API base URL")
    .option("--api-key-env <name>", "Environment variable containing the bearer token")
    .option("--config <path>", "CLI profile config JSON")
    .option("--profile <name>", "CLI profile name")
    .option("--preview", "Print the request that would be sent without calling the API")
    .option("--diff", "Include request diff lines in preview output");

  const context = createCliContext(options);
  addSubjectCommands(program, context);
  addResourceCommands(program, context);
  addRelationCommands(program, context);
  addPolicyCommands(program, context);
  addDecisionCommands(program, context);
  addProvisioningCommands(program, context);
  addReconciliationCommands(program, context);
  addDiscoveryCommands(program, context);
  addAuditCommands(program, context);
  addEvidenceCommands(program, context);
  addConnectorCommands(program, context);
  addCompletionCommand(program, context);

  return program;
}

interface CliContext {
  fetch: typeof fetch;
  defaultApiUrl?: string;
  defaultApiKeyEnv?: string;
  configPath?: string;
  env: NodeJS.ProcessEnv;
  profiles: Record<string, CliProfile>;
  writeText: (value: string) => void;
  writeJson: (value: unknown) => void;
  now: () => string;
}

interface RootCliOptions {
  apiUrl?: string;
  apiKeyEnv?: string;
  config?: string;
  profile?: string;
  preview?: boolean;
  diff?: boolean;
}

interface CommandWithConnector {
  connector?: string;
}

interface CommandWithMode {
  mode?: "read_only" | "simulation" | "dry_run" | "enforcement";
}

interface ReconcileRunOptions extends CommandWithConnector {
  dryRun?: boolean;
  scheduled?: boolean;
  cadence?: string;
  scheduledAt?: string;
}

interface ReconcileFindingsOptions {
  severity?: string;
  status?: string;
  lifecycleState?: string;
}

interface ReconcileRemediateOptions {
  approver?: string;
  changeTicket?: string;
  readinessReport?: string;
  ticket?: string;
  siem?: string;
  maxSeverity?: string;
}

interface DiscoveryRunsOptions extends CommandWithConnector {
  status?: string;
}

interface NativeAccessOptions extends CommandWithConnector {
  subject?: string;
  permission?: string;
  grantType?: string;
  principalType?: string;
}

interface ProvisioningOptions extends CommandWithConnector {
  mode?: "dry_run" | "enforcement";
  approver?: string;
  changeTicket?: string;
  reason?: string;
  syntheticOnly?: boolean;
  incidentMode?: boolean;
  breakGlass?: boolean;
  readinessReport?: string;
}

interface ConnectorReadinessOptions {
  mode?: "enforcement";
  syntheticOnly?: boolean;
  incidentMode?: boolean;
  breakGlass?: boolean;
  approverRole?: string;
  changeTicketPattern?: string;
  status?: string;
}

interface AuditSearchOptions {
  subject?: string;
  resource?: string;
  from?: string;
}

interface EvidenceExportOptions {
  framework: string;
  controls: string;
  format?: string;
  from?: string;
  to?: string;
}

interface EvidenceVerifyOptions {
  package?: string;
}

function createCliContext(options: CliOptions): CliContext {
  return {
    defaultApiUrl: options.apiUrl,
    defaultApiKeyEnv: options.apiKeyEnv,
    configPath: options.configPath,
    env: options.env ?? process.env,
    fetch: options.fetch ?? fetch,
    profiles: options.profiles ?? {},
    writeText:
      options.writeText ??
      ((value: string) => {
        console.log(value);
      }),
    writeJson:
      options.writeJson ??
      ((value: unknown) => {
        console.log(JSON.stringify(value, null, 2));
      }),
    now: options.now ?? (() => new Date().toISOString())
  };
}

function addSubjectCommands(program: Command, context: CliContext): void {
  const subject = program.command("subject").description("Subject inventory and access commands.");
  const sync = subject.command("sync").requiredOption("--connector <id>");
  sync.action(withApi(context, sync, async (client) => {
    const options = sync.opts<CommandWithConnector>();
    return client.post(`/v1/connectors/${encodeURIComponent(required(options.connector, "connector"))}/sync`, {
      mode: "read_only"
    });
  }));

  const get = subject.command("get").argument("<subject-id>");
  get.action(withApi(context, get, (client, args) => {
    return client.get(`/v1/subjects/${encodeURIComponent(readString(args, 0, "subject-id"))}`);
  }));

  const access = subject.command("access").argument("<subject-id>");
  access.action(withApi(context, access, (client, args) => {
    return client.get(`/v1/subjects/${encodeURIComponent(readString(args, 0, "subject-id"))}/access`);
  }));
}

function addResourceCommands(program: Command, context: CliContext): void {
  const resource = program.command("resource").description("Resource inventory and access commands.");
  const discover = resource.command("discover").requiredOption("--connector <id>");
  discover.action(withApi(context, discover, async (client) => {
    const options = discover.opts<CommandWithConnector>();
    return client.post(`/v1/connectors/${encodeURIComponent(required(options.connector, "connector"))}/sync`, {
      mode: "read_only"
    });
  }));

  const get = resource.command("get").argument("<resource-id>");
  get.action(withApi(context, get, (client, args) => {
    return client.get(`/v1/resources/${encodeURIComponent(readString(args, 0, "resource-id"))}`);
  }));

  const access = resource.command("access").argument("<resource-id>");
  access.action(withApi(context, access, (client, args) => {
    return client.get(`/v1/resources/${encodeURIComponent(readString(args, 0, "resource-id"))}/access`);
  }));

  const nativeAccess = resource
    .command("native-access")
    .argument("<resource-id>")
    .option("--connector <id>")
    .option("--subject <id>")
    .option("--permission <permission>")
    .option("--grant-type <type>")
    .option("--principal-type <type>");
  nativeAccess.action(withApi(context, nativeAccess, (client, args) => {
    const options = nativeAccess.opts<NativeAccessOptions>();
    const params = new URLSearchParams();
    if (options.connector) params.set("connectorId", options.connector);
    if (options.subject) params.set("subjectId", options.subject);
    if (options.permission) params.set("nativePermission", options.permission);
    if (options.grantType) params.set("grantType", options.grantType);
    if (options.principalType) params.set("principalType", options.principalType);
    const query = params.toString();
    return client.get(
      `/v1/resources/${encodeURIComponent(readString(args, 0, "resource-id"))}/native-access${query ? `?${query}` : ""}`
    );
  }));
}

function addRelationCommands(program: Command, context: CliContext): void {
  const relation = program.command("relation").description("Relationship tuple commands.");

  const set = relation.command("set").argument("<subject>").argument("<relation>").argument("<object>");
  set.action(withApi(context, set, (client, args) => {
    const [subjectId, relationName, objectId] = readStrings(args, ["subject", "relation", "object"]);
    const timestamp = context.now();
    return client.put("/v1/relationships", {
      id: relationshipId(subjectId, relationName, objectId),
      subjectId,
      relation: relationName,
      objectId,
      sourceSystem: "cli",
      assertedAt: timestamp,
      status: "active",
      version: "tuple:cli-v1",
      createdAt: timestamp
    });
  }));

  const del = relation.command("delete").argument("<subject>").argument("<relation>").argument("<object>");
  del.action(withApi(context, del, (client, args) => {
    const [subjectId, relationName, objectId] = readStrings(args, ["subject", "relation", "object"]);
    return client.delete(`/v1/relationships?relationshipId=${encodeURIComponent(relationshipId(subjectId, relationName, objectId))}`);
  }));

  const path = relation.command("path").argument("<subject>").argument("<resource>");
  path.action(withApi(context, path, (client, args) => {
    const [subjectId, resourceId] = readStrings(args, ["subject", "resource"]);
    return client.get(`/v1/relationships?subjectId=${encodeURIComponent(subjectId)}&objectId=${encodeURIComponent(resourceId)}`);
  }));
}

function addPolicyCommands(program: Command, context: CliContext): void {
  const policy = program.command("policy").description("Policy validation and publishing commands.");

  const validate = policy.command("validate").argument("<policy-file>");
  validate.action(withApi(context, validate, (client, args) => {
    const policyFile = readString(args, 0, "policy-file");
    return client.post(`/v1/policies/${encodeURIComponent(policyFile)}/validate`, {
      mode: "validate",
      policyFile
    });
  }));

  const test = policy.command("test").argument("<test-file>");
  test.action(withApi(context, test, (client, args) => {
    const testFile = readString(args, 0, "test-file");
    return client.post(`/v1/policies/${encodeURIComponent(testFile)}/validate`, {
      mode: "test",
      testFile
    });
  }));

  const publish = policy.command("publish").argument("<policy-file>").requiredOption("--change-ticket <id>");
  publish.action(withApi(context, publish, (client, args) => {
    const options = publish.opts<{ changeTicket: string }>();
    const policyFile = readString(args, 0, "policy-file");
    return client.post(`/v1/policies/${encodeURIComponent(policyFile)}/publish`, {
      changeTicket: options.changeTicket,
      approverId: "user:cli-operator"
    });
  }));
}

function addDecisionCommands(program: Command, context: CliContext): void {
  const check = program.command("check").argument("<subject>").argument("<action>").argument("<resource>");
  check.action(withApi(context, check, (client, args) => {
    const [subjectId, action, resourceId] = readStrings(args, ["subject", "action", "resource"]);
    return client.post("/v1/decision/check", { subjectId, action, resourceId });
  }));

  const explain = program.command("explain").argument("<subject>").argument("<action>").argument("<resource>");
  explain.action(withApi(context, explain, (client, args) => {
    const [subjectId, action, resourceId] = readStrings(args, ["subject", "action", "resource"]);
    return client.post("/v1/decision/explain", { subjectId, action, resourceId });
  }));
}

function addProvisioningCommands(program: Command, context: CliContext): void {
  const provision = program.command("provision").description("Provisioning plan and job commands.");

  const plan = addControlledEnforcementOptions(
    provision.command("plan").argument("<subject>").argument("<resource>").argument("<action>").option("--connector <id>")
  );
  plan.action(withApi(context, plan, (client, args) => {
    const options = plan.opts<ProvisioningOptions>();
    const [subjectId, resourceId, action] = readStrings(args, ["subject", "resource", "action"]);
    return client.post("/v1/provisioning/plans", {
      subjectId,
      resourceId,
      action,
      connectorId: options.connector,
      ...buildProvisioningExecutionPayload(options, context)
    });
  }));

  const apply = addControlledEnforcementOptions(provision.command("apply").argument("<plan-id>"), {
    includeReadinessReport: false
  });
  apply.action(withApi(context, apply, (client, args) => {
    const options = apply.opts<ProvisioningOptions>();
    return client.post("/v1/provisioning/jobs", {
      planId: readString(args, 0, "plan-id"),
      approverId: options.approver ?? "user:cli-operator",
      ...buildProvisioningJobPayload(options, context)
    });
  }));

  const revoke = addControlledEnforcementOptions(provision.command("revoke").argument("<grant-id>").option("--connector <id>"));
  revoke.action(withApi(context, revoke, (client, args) => {
    const options = revoke.opts<ProvisioningOptions>();
    return client.post("/v1/provisioning/plans", {
      grantId: readString(args, 0, "grant-id"),
      connectorId: options.connector,
      action: "revoke",
      ...buildProvisioningExecutionPayload(options, context)
    });
  }));
}

function addControlledEnforcementOptions(
  command: Command,
  options: { includeReadinessReport?: boolean } = {}
): Command {
  const configured = command
    .option("--mode <mode>", "dry_run")
    .option("--approver <id>")
    .option("--change-ticket <id>")
    .option("--reason <text>")
    .option("--synthetic-only")
    .option("--incident-mode")
    .option("--break-glass");

  return options.includeReadinessReport === false
    ? configured
    : configured.option("--readiness-report <id>");
}

function buildProvisioningJobPayload(options: ProvisioningOptions, context: CliContext): Record<string, unknown> {
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

function buildProvisioningExecutionPayload(options: ProvisioningOptions, context: CliContext): Record<string, unknown> {
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

function addReconciliationCommands(program: Command, context: CliContext): void {
  const reconcile = program.command("reconcile").description("Reconciliation and drift commands.");

  const run = reconcile.command("run").requiredOption("--connector <id>").option("--dry-run");
  run.option("--scheduled", "mark the reconciliation as scheduled").option("--cadence <cadence>").option("--scheduled-at <date>");
  run.action(withApi(context, run, (client) => {
    const options = run.opts<ReconcileRunOptions>();
    const body: Record<string, unknown> = {
      connectorId: required(options.connector, "connector"),
      dryRun: options.dryRun ?? true
    };

    if (options.scheduled || options.cadence || options.scheduledAt) {
      body.trigger = options.scheduled ? "scheduled" : "manual";
      body.schedule = {
        cadence: options.cadence ?? (options.scheduled ? "daily" : "manual"),
        scheduledAt: options.scheduledAt ?? context.now()
      };
    }

    return client.post("/v1/reconciliation/run", body);
  }));

  const findings = reconcile.command("findings").option("--severity <severity>").option("--status <status>").option("--lifecycle-state <state>");
  findings.action(withApi(context, findings, (client) => {
    const options = findings.opts<ReconcileFindingsOptions>();
    const params = new URLSearchParams();
    if (options.severity) params.set("severity", options.severity);
    if (options.status) params.set("status", options.status);
    if (options.lifecycleState) params.set("lifecycleState", options.lifecycleState);
    const query = params.toString();
    return client.get(`/v1/reconciliation/findings${query ? `?${query}` : ""}`);
  }));

  const remediate = reconcile
    .command("remediate")
    .requiredOption("--finding <id>")
    .requiredOption("--change-ticket <id>")
    .requiredOption("--readiness-report <id>")
    .option("--approver <id>")
    .option("--ticket <id>")
    .option("--siem <id>")
    .option("--max-severity <severity>", "maximum severity allowed by the auto-repair policy", "high");
  remediate.action(withApi(context, remediate, (client) => {
    const options = remediate.opts<ReconcileRemediateOptions & { finding?: string }>();
    const approvedAt = context.now();
    const hookEvidence = [
      options.ticket
        ? { system: "ticket", referenceId: options.ticket, status: "linked", recordedAt: approvedAt }
        : undefined,
      options.siem
        ? { system: "siem", referenceId: options.siem, status: "notified", recordedAt: approvedAt }
        : undefined
    ].filter(Boolean);

    return client.post(`/v1/reconciliation/findings/${encodeURIComponent(required(options.finding, "finding"))}/remediation`, {
      approval: {
        decision: "approved",
        approverId: options.approver ?? "user:cli-operator",
        changeTicket: required(options.changeTicket, "change-ticket"),
        approvedAt
      },
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["revoke", "repair", "review"],
        maxSeverity: options.maxSeverity ?? "high",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false,
        reason: "CLI dry-run remediation records approval evidence without executing provider writes."
      },
      readinessReportId: required(options.readinessReport, "readiness-report"),
      hookEvidence
    });
  }));
}

function addDiscoveryCommands(program: Command, context: CliContext): void {
  const discovery = program.command("discovery").description("Read-only discovery run inspection.");
  const runs = discovery.command("runs").option("--connector <id>").option("--status <status>");
  runs.action(withApi(context, runs, (client) => {
    const options = runs.opts<DiscoveryRunsOptions>();
    const params = new URLSearchParams();
    if (options.connector) params.set("connectorId", options.connector);
    if (options.status) params.set("status", options.status);
    const query = params.toString();
    return client.get(`/v1/discovery/runs${query ? `?${query}` : ""}`);
  }));
}

function addAuditCommands(program: Command, context: CliContext): void {
  const audit = program.command("audit").description("Audit event commands.");
  const search = audit.command("search").option("--subject <id>").option("--resource <id>").option("--from <date>");
  search.action(withApi(context, search, (client) => {
    const options = search.opts<AuditSearchOptions>();
    const params = new URLSearchParams();
    if (options.subject) params.set("subjectId", options.subject);
    if (options.resource) params.set("resourceId", options.resource);
    if (options.from) params.set("from", options.from);
    const query = params.toString();
    return client.get(`/v1/audit/events${query ? `?${query}` : ""}`);
  }));

  const integrity = audit.command("integrity");
  integrity.action(withApi(context, integrity, (client) => client.get("/v1/audit/integrity")));

  const exportCommand = audit
    .command("export")
    .option("--from <date>")
    .option("--to <date>")
    .option("--target <target>", "audit export target", "operator_download");
  exportCommand.action(withApi(context, exportCommand, (client) => {
    const options = exportCommand.opts<{ from?: string; to?: string; target?: string }>();
    const params = new URLSearchParams();
    if (options.from) params.set("from", options.from);
    if (options.to) params.set("to", options.to);
    if (options.target) params.set("target", options.target);
    const query = params.toString();
    return client.get(`/v1/audit/export${query ? `?${query}` : ""}`);
  }));
}

function addEvidenceCommands(program: Command, context: CliContext): void {
  const evidence = program.command("evidence").description("ATO evidence commands.");
  const exportCommand = evidence
    .command("export")
    .requiredOption("--framework <name>")
    .requiredOption("--controls <list>")
    .option("--from <date>")
    .option("--to <date>")
    .option("--format <format>", "json");
  exportCommand.action(withApi(context, exportCommand, (client) => {
    const options = exportCommand.opts<EvidenceExportOptions>();
    const params = new URLSearchParams({
      framework: options.framework,
      controls: options.controls,
      format: options.format ?? "json"
    });
    if (options.from) params.set("from", options.from);
    if (options.to) params.set("to", options.to);
    return client.get(`/v1/evidence/export?${params.toString()}`);
  }));

  const verify = evidence
    .command("verify")
    .requiredOption("--package <path>");
  verify.action(withApi(context, verify, async (client) => {
    const options = verify.opts<EvidenceVerifyOptions>();
    return client.post("/v1/evidence/verify", await readEvidencePackageFile(required(options.package, "package")));
  }));
}

function addConnectorCommands(program: Command, context: CliContext): void {
  const connector = program.command("connector").description("Connector inventory and operations.");

  const list = connector.command("list");
  list.action(withApi(context, list, (client) => client.get("/v1/connectors")));

  const test = connector.command("test").argument("<connector-id>");
  test.action(withApi(context, test, (client, args) => {
    return client.post(`/v1/connectors/${encodeURIComponent(readString(args, 0, "connector-id"))}/test`, {});
  }));

  const readiness = connector
    .command("readiness")
    .argument("<connector-id>")
    .option("--mode <mode>", "enforcement")
    .option("--synthetic-only")
    .option("--incident-mode")
    .option("--break-glass")
    .option("--approver-role <role>")
    .option("--change-ticket-pattern <pattern>")
    .option("--status <status>");
  readiness.action(withApi(context, readiness, (client, args) => {
    const options = readiness.opts<ConnectorReadinessOptions>();
    const connectorId = encodeURIComponent(readString(args, 0, "connector-id"));

    if (options.status) {
      return client.get(`/v1/connectors/${connectorId}/enforcement-readiness?status=${encodeURIComponent(options.status)}`);
    }

    return client.post(`/v1/connectors/${connectorId}/enforcement-readiness`, {
      mode: options.mode ?? "enforcement",
      control: {
        syntheticOnly: options.syntheticOnly === true,
        liveProviderWrites: false,
        incidentMode: options.incidentMode === true,
        breakGlass: options.breakGlass === true
      },
      requiredApproverRole: options.approverRole,
      changeTicketPattern: options.changeTicketPattern
    });
  }));

  const sync = connector.command("sync").argument("<connector-id>").option("--mode <mode>", "read_only");
  sync.action(withApi(context, sync, (client, args) => {
    const options = sync.opts<CommandWithMode>();
    return client.post(`/v1/connectors/${encodeURIComponent(readString(args, 0, "connector-id"))}/sync`, {
      mode: options.mode ?? "read_only"
    });
  }));
}

function addCompletionCommand(program: Command, context: CliContext): void {
  const completion = program.command("completion").argument("<shell>").description("Print shell completion for bash, zsh, or fish.");
  completion.action((shell: string) => {
    context.writeText(renderShellCompletion(shell, program));
  });
}

function withApi(
  context: CliContext,
  command: Command,
  handler: (client: ApiClient, args: unknown[]) => Promise<unknown>
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    try {
      const client = new ApiClient(resolveRuntimeOptions(command, context), context.fetch);
      context.writeJson(await handler(client, args));
    } catch (error) {
      process.stderr.write(`error: ${formatCliError(error)}\n`);
      process.exitCode = error instanceof CliConfigurationError
        ? CLI_EXIT_CODES.configuration
        : CLI_EXIT_CODES.apiFailure;
    }
  };
}

class ApiClient {
  constructor(
    readonly options: CliRuntimeOptions,
    readonly fetchImpl: typeof fetch
  ) {}

  get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  put(path: string, body: unknown): Promise<unknown> {
    return this.request("PUT", path, body);
  }

  delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const idempotencyKey = createIdempotencyKey(method, path, body);

    if (this.options.preview) {
      return buildRequestPreview(this.options, method, path, body, idempotencyKey);
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    };

    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    const response = await this.fetchImpl(`${this.options.apiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = parseResponseBody(await response.text());

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${JSON.stringify(payload)}`);
    }

    return payload;
  }
}

class CliConfigurationError extends Error {}

function resolveRuntimeOptions(command: Command, context: CliContext): CliRuntimeOptions {
  const root = getRootCommand(command);
  const rootOptions = root.opts<RootCliOptions>();
  const profileConfig = readProfileConfig(rootOptions, context);
  const profileName = rootOptions.profile ?? context.env.REBAC_PROFILE;
  const profile = readProfile(profileConfig, profileName);
  const apiKeyEnv = rootOptions.apiKeyEnv
    ?? profile?.apiKeyEnv
    ?? context.defaultApiKeyEnv
    ?? context.env.REBAC_API_KEY_ENV
    ?? "REBAC_API_KEY";

  return {
    apiUrl: rootOptions.apiUrl
      ?? profile?.apiUrl
      ?? context.defaultApiUrl
      ?? context.env.REBAC_API_URL
      ?? "http://127.0.0.1:3000",
    apiKey: context.env[apiKeyEnv],
    preview: rootOptions.preview === true,
    diff: rootOptions.diff === true
  };
}

function readProfileConfig(rootOptions: RootCliOptions, context: CliContext): CliProfileConfig {
  const configPath = rootOptions.config ?? context.configPath ?? context.env.REBAC_CLI_CONFIG;
  const profiles = { ...context.profiles };

  if (!configPath) {
    return { profiles };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    const config = parseProfileConfig(parsed, configPath);
    return {
      profiles: {
        ...profiles,
        ...config.profiles
      }
    };
  } catch (error) {
    if (error instanceof CliConfigurationError) {
      throw error;
    }

    throw new CliConfigurationError(`Unable to read CLI config ${configPath}: ${formatCliError(error)}`);
  }
}

function parseProfileConfig(value: unknown, path: string): CliProfileConfig {
  if (!isRecord(value)) {
    throw new CliConfigurationError(`CLI config ${path} must be a JSON object.`);
  }

  if (value.profiles === undefined) {
    return { profiles: {} };
  }

  if (!isRecord(value.profiles)) {
    throw new CliConfigurationError(`CLI config ${path} profiles must be an object.`);
  }

  const profiles: Record<string, CliProfile> = {};
  for (const [name, profile] of Object.entries(value.profiles)) {
    if (!isRecord(profile)) {
      throw new CliConfigurationError(`CLI profile ${name} must be an object.`);
    }

    profiles[name] = {
      apiUrl: readOptionalString(profile.apiUrl, `${name}.apiUrl`),
      apiKeyEnv: readOptionalString(profile.apiKeyEnv, `${name}.apiKeyEnv`)
    };
  }

  return { profiles };
}

function readProfile(config: CliProfileConfig, profileName: string | undefined): CliProfile | undefined {
  if (!profileName) {
    return undefined;
  }

  const profile = config.profiles?.[profileName];
  if (!profile) {
    throw new CliConfigurationError(`CLI profile ${profileName} was not found.`);
  }

  return profile;
}

function buildRequestPreview(
  options: CliRuntimeOptions,
  method: string,
  path: string,
  body: unknown,
  idempotencyKey: string
): Record<string, unknown> {
  const preview: Record<string, unknown> = {
    mode: "preview",
    apiUrl: options.apiUrl,
    method,
    path,
    idempotencyKey
  };

  if (body !== undefined) {
    preview.body = body;
  }

  if (options.diff) {
    preview.diff = buildRequestDiff(method, path, body);
  }

  return preview;
}

function buildRequestDiff(method: string, path: string, body: unknown): string[] {
  const lines = [`+ ${method} ${path}`];

  if (body !== undefined) {
    lines.push(...JSON.stringify(body, null, 2).split("\n").map((line) => `+ ${line}`));
  }

  return lines;
}

function createIdempotencyKey(method: string, path: string, body: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ method, path, body }))
    .digest("hex")
    .slice(0, 32);
  return `idem:cli:${method.toLowerCase()}:${hash}`;
}

function parseResponseBody(body: string): unknown {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function readEvidencePackageFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read evidence package ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRootCommand(command: Command): Command {
  let root = command;
  while (root.parent) {
    root = root.parent;
  }

  return root;
}

function relationshipId(subjectId: string, relation: string, objectId: string): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ objectId, relation, subjectId }))
    .digest("hex")
    .slice(0, 32);
  return `relationship:cli:${hash}`;
}

function readString(args: unknown[], index: number, name: string): string {
  const value = args[index];

  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }

  return value;
}

function readStrings(args: unknown[], names: string[]): string[] {
  return names.map((name, index) => readString(args, index, name));
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function renderShellCompletion(shell: string, program: Command): string {
  const words = completionWords(program);

  if (shell === "bash") {
    return [
      "_rebac_completion() {",
      "  COMPREPLY=($(compgen -W \"" + words.join(" ") + "\" -- \"${COMP_WORDS[COMP_CWORD]}\"))",
      "}",
      "complete -F _rebac_completion rebac"
    ].join("\n");
  }

  if (shell === "zsh") {
    return `#compdef rebac\n_arguments '*: :(${words.join(" ")})'`;
  }

  if (shell === "fish") {
    return words.map((word) => `complete -c rebac -f -a ${quoteFishWord(word)}`).join("\n");
  }

  throw new CliConfigurationError("completion shell must be bash, zsh, or fish");
}

function completionWords(command: Command): string[] {
  const words = new Set([
    "--api-url",
    "--api-key-env",
    "--config",
    "--profile",
    "--preview",
    "--diff"
  ]);

  for (const spec of CLI_COMMANDS) {
    for (const word of spec.path.split(" ")) {
      words.add(word);
    }
  }

  for (const child of command.commands) {
    words.add(child.name());
  }

  return [...words].sort();
}

function quoteFishWord(word: string): string {
  return `'${word.replace(/'/g, "\\'")}'`;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new CliConfigurationError(`CLI profile field ${label} must be a non-empty string.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
