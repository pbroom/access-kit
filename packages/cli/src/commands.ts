import { createHash } from "node:crypto";
import { Command } from "commander";

export interface CliCommandSpec {
  path: string;
  description: string;
  apiSurface: string;
}

export interface CliOptions {
  apiUrl?: string;
  fetch?: typeof fetch;
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
  { path: "discovery runs", description: "List read-only connector discovery runs.", apiSurface: "GET /v1/discovery/runs" },
  { path: "audit search", description: "Search append-only audit events.", apiSurface: "GET /v1/audit/events" },
  { path: "audit integrity", description: "Verify append-only audit hash-chain integrity.", apiSurface: "GET /v1/audit/integrity" },
  { path: "audit export", description: "Export SIEM-ready audit events.", apiSurface: "GET /v1/audit/export" },
  { path: "evidence export", description: "Export ATO evidence.", apiSurface: "GET /v1/evidence/export" },
  { path: "connector list", description: "List connectors and capabilities.", apiSurface: "GET /v1/connectors" },
  { path: "connector test", description: "Test connector health and permissions.", apiSurface: "POST /v1/connectors/{id}/test" },
  { path: "connector readiness", description: "Check controlled-enforcement readiness for a connector.", apiSurface: "POST /v1/connectors/{id}/enforcement-readiness" },
  { path: "connector sync", description: "Run connector discovery or reconciliation.", apiSurface: "POST /v1/connectors/{id}/sync" }
];

export function buildCli(options: CliOptions = {}): Command {
  const program = new Command();
  program
    .name("rebac")
    .description("Operator CLI for the Access Kit ReBAC control plane.")
    .version("0.1.0")
    .option("--api-url <url>", "ReBAC API base URL", options.apiUrl ?? process.env.REBAC_API_URL ?? "http://127.0.0.1:3000");

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

  return program;
}

interface CliContext {
  fetch: typeof fetch;
  writeJson: (value: unknown) => void;
  now: () => string;
}

interface CommandWithConnector {
  connector?: string;
}

interface CommandWithMode {
  mode?: "read_only" | "simulation" | "dry_run" | "enforcement";
}

interface ReconcileRunOptions extends CommandWithConnector {
  dryRun?: boolean;
}

interface ReconcileFindingsOptions {
  severity?: string;
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

function createCliContext(options: CliOptions): CliContext {
  return {
    fetch: options.fetch ?? fetch,
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
  run.action(withApi(context, run, (client) => {
    const options = run.opts<ReconcileRunOptions>();
    return client.post("/v1/reconciliation/run", {
      connectorId: required(options.connector, "connector"),
      dryRun: options.dryRun ?? true
    });
  }));

  const findings = reconcile.command("findings").option("--severity <severity>");
  findings.action(withApi(context, findings, (client) => {
    const options = findings.opts<ReconcileFindingsOptions>();
    const params = new URLSearchParams();
    if (options.severity) params.set("severity", options.severity);
    const query = params.toString();
    return client.get(`/v1/reconciliation/findings${query ? `?${query}` : ""}`);
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

function withApi(
  context: CliContext,
  command: Command,
  handler: (client: ApiClient, args: unknown[]) => Promise<unknown>
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    try {
      const client = new ApiClient(getApiUrl(command), context.fetch);
      context.writeJson(await handler(client, args));
    } catch (error) {
      process.stderr.write(`error: ${formatCliError(error)}\n`);
      process.exitCode = 1;
    }
  };
}

class ApiClient {
  constructor(
    readonly apiUrl: string,
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
    const response = await this.fetchImpl(`${this.apiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "idempotency-key": createIdempotencyKey(method, path, body)
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = parseResponseBody(await response.text());

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${JSON.stringify(payload)}`);
    }

    return payload;
  }
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

function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getApiUrl(command: Command): string {
  let root = command;
  while (root.parent) {
    root = root.parent;
  }

  return root.opts<{ apiUrl: string }>().apiUrl;
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
