import { Command } from "commander";

export interface CliCommandSpec {
  path: string;
  description: string;
  apiSurface: string;
}

export const CLI_COMMANDS: CliCommandSpec[] = [
  { path: "subject sync", description: "Sync subjects from a connector.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "subject get", description: "Inspect a canonical subject.", apiSurface: "GET /v1/subjects/{id}" },
  { path: "subject access", description: "Explain current subject access.", apiSurface: "GET /v1/subjects/{id}/access" },
  // Discovery-oriented commands share the connector sync endpoint until provider-specific inventory endpoints land.
  { path: "resource discover", description: "Discover resources from a connector.", apiSurface: "POST /v1/connectors/{id}/sync" },
  { path: "resource get", description: "Inspect a canonical resource.", apiSurface: "GET /v1/resources/{id}" },
  { path: "resource access", description: "Explain resource access paths.", apiSurface: "GET /v1/resources/{id}/access" },
  { path: "relation set", description: "Create or replace a relationship tuple.", apiSurface: "PUT /v1/relationships" },
  { path: "relation delete", description: "Delete a relationship tuple.", apiSurface: "DELETE /v1/relationships" },
  { path: "relation path", description: "Show relationship paths between subject and resource.", apiSurface: "GET /v1/relationships" },
  { path: "policy validate", description: "Validate a policy model.", apiSurface: "POST /v1/policies/{id}/validate" },
  { path: "policy test", description: "Run policy proof-point tests.", apiSurface: "POST /v1/policies/{id}/validate" },
  { path: "policy publish", description: "Publish an approved policy model.", apiSurface: "POST /v1/policies/{id}/publish" },
  { path: "check", description: "Run a fast allow/deny decision.", apiSurface: "POST /v1/decision/check" },
  { path: "explain", description: "Run an explainable decision.", apiSurface: "POST /v1/decision/explain" },
  { path: "provision plan", description: "Create a dry-run provisioning plan.", apiSurface: "POST /v1/provisioning/plans" },
  { path: "provision apply", description: "Apply an approved provisioning plan.", apiSurface: "POST /v1/provisioning/jobs" },
  { path: "provision revoke", description: "Create a revocation plan.", apiSurface: "POST /v1/provisioning/plans" },
  { path: "reconcile run", description: "Run reconciliation for a connector.", apiSurface: "POST /v1/reconciliation/run" },
  { path: "reconcile findings", description: "List drift findings.", apiSurface: "GET /v1/reconciliation/findings" },
  { path: "audit search", description: "Search append-only audit events.", apiSurface: "GET /v1/audit/events" },
  { path: "evidence export", description: "Export ATO evidence.", apiSurface: "GET /v1/evidence/export" },
  { path: "connector list", description: "List connectors and capabilities.", apiSurface: "GET /v1/connectors" },
  { path: "connector test", description: "Test connector health and permissions.", apiSurface: "POST /v1/connectors/{id}/test" },
  { path: "connector sync", description: "Run connector discovery or reconciliation.", apiSurface: "POST /v1/connectors/{id}/sync" }
];

export function buildCli(): Command {
  const program = new Command();
  program
    .name("rebac")
    .description("Operator CLI for the Access Kit ReBAC control plane.")
    .version("0.1.0");

  addSubjectCommands(program);
  addResourceCommands(program);
  addRelationCommands(program);
  addPolicyCommands(program);
  addDecisionCommands(program);
  addProvisioningCommands(program);
  addReconciliationCommands(program);
  addAuditCommands(program);
  addEvidenceCommands(program);
  addConnectorCommands(program);

  return program;
}

function addSubjectCommands(program: Command): void {
  const subject = program.command("subject").description("Subject inventory and access commands.");
  subject.command("sync").requiredOption("--connector <id>").action(outputContract("subject sync"));
  subject.command("get").argument("<subject-id>").action(outputContract("subject get"));
  subject.command("access").argument("<subject-id>").action(outputContract("subject access"));
}

function addResourceCommands(program: Command): void {
  const resource = program.command("resource").description("Resource inventory and access commands.");
  resource.command("discover").requiredOption("--connector <id>").action(outputContract("resource discover"));
  resource.command("get").argument("<resource-id>").action(outputContract("resource get"));
  resource.command("access").argument("<resource-id>").action(outputContract("resource access"));
}

function addRelationCommands(program: Command): void {
  const relation = program.command("relation").description("Relationship tuple commands.");
  relation.command("set").argument("<subject>").argument("<relation>").argument("<object>").action(outputContract("relation set"));
  relation.command("delete").argument("<subject>").argument("<relation>").argument("<object>").action(outputContract("relation delete"));
  relation.command("path").argument("<subject>").argument("<resource>").action(outputContract("relation path"));
}

function addPolicyCommands(program: Command): void {
  const policy = program.command("policy").description("Policy validation and publishing commands.");
  policy.command("validate").argument("<policy-file>").action(outputContract("policy validate"));
  policy.command("test").argument("<test-file>").action(outputContract("policy test"));
  policy.command("publish").argument("<policy-file>").requiredOption("--change-ticket <id>").action(outputContract("policy publish"));
}

function addDecisionCommands(program: Command): void {
  program.command("check").argument("<subject>").argument("<action>").argument("<resource>").action(outputContract("check"));
  program.command("explain").argument("<subject>").argument("<action>").argument("<resource>").action(outputContract("explain"));
}

function addProvisioningCommands(program: Command): void {
  const provision = program.command("provision").description("Provisioning plan and job commands.");
  provision.command("plan").argument("<subject>").argument("<resource>").argument("<action>").action(outputContract("provision plan"));
  provision.command("apply").argument("<plan-id>").action(outputContract("provision apply"));
  provision.command("revoke").argument("<grant-id>").action(outputContract("provision revoke"));
}

function addReconciliationCommands(program: Command): void {
  const reconcile = program.command("reconcile").description("Reconciliation and drift commands.");
  reconcile.command("run").requiredOption("--connector <id>").option("--dry-run").action(outputContract("reconcile run"));
  reconcile.command("findings").option("--severity <severity>").action(outputContract("reconcile findings"));
}

function addAuditCommands(program: Command): void {
  const audit = program.command("audit").description("Audit event commands.");
  audit.command("search").option("--subject <id>").option("--resource <id>").option("--from <date>").action(outputContract("audit search"));
}

function addEvidenceCommands(program: Command): void {
  const evidence = program.command("evidence").description("ATO evidence commands.");
  evidence.command("export").requiredOption("--framework <name>").requiredOption("--controls <list>").option("--format <format>", "json").action(outputContract("evidence export"));
}

function addConnectorCommands(program: Command): void {
  const connector = program.command("connector").description("Connector inventory and operations.");
  connector.command("list").action(outputContract("connector list"));
  connector.command("test").argument("<connector-id>").action(outputContract("connector test"));
  connector.command("sync").argument("<connector-id>").option("--mode <mode>", "read_only").action(outputContract("connector sync"));
}

function outputContract(commandPath: string): () => void {
  return () => {
    const command = CLI_COMMANDS.find((candidate) => candidate.path === commandPath);
    console.log(JSON.stringify({ command: commandPath, apiSurface: command?.apiSurface }, null, 2));
  };
}
