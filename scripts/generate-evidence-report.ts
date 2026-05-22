import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

interface CommandResult {
  name: string;
  command: string;
  status: "pass" | "fail";
  output: string;
}

const root = process.cwd();
const reportPath = join(root, "reports/proof-point-validation.md");
const commands: Array<{ name: string; args: string[] }> = [
  { name: "typecheck", args: ["typecheck"] },
  { name: "schema validation", args: ["validate:schemas"] },
  { name: "OpenAPI validation", args: ["validate:openapi"] },
  { name: "policy fixture validation", args: ["validate:policy"] },
  { name: "core engine tests", args: ["test:core"] },
  { name: "API runtime tests", args: ["test:api"] },
  { name: "CLI API smoke tests", args: ["test:cli"] }
];

const results = commands.map(runPnpm);
const branch = run("git", ["branch", "--show-current"]).output.trim();
const nodeVersion = run("node", ["--version"]).output.trim();
const pnpmVersion = run("corepack", ["pnpm", "--version"]).output.trim();
const generatedAt = new Date().toISOString();
const failed = results.filter((result) => result.status === "fail");

const report = `# Proof-Point Validation Evidence

Generated at: ${generatedAt}

Branch: ${branch}

Node: ${nodeVersion}

pnpm: ${pnpmVersion}

## Summary

${failed.length === 0 ? "All proof-point validation commands passed." : `${failed.length} proof-point validation command(s) failed.`}

| Proof point | Command | Result |
| --- | --- | --- |
${results.map((result) => `| ${result.name} | \`${result.command}\` | ${result.status.toUpperCase()} |`).join("\n")}

## Command Output

${results
  .map(
    (result) => `### ${result.name}

\`\`\`text
${trimOutput(result.output)}
\`\`\`
`
  )
  .join("\n")}

## Covered Proof Points

- TypeScript strict type checking.
- JSON Schema validation for subject, resource, relationship, decision, native grant, discovery run, provisioning plan, audit event, drift finding, and evidence export examples.
- OpenAPI validation for required decision, inventory, native access, relationship, policy, provisioning, reconciliation, audit, evidence, and connector path groups.
- Policy fixtures for deny by default, relationship allow, deny override, expired access denial, suspended-user denial, idempotency, and drift finding.
- Local core engine tests for deterministic check/explain and decision audit emission.
- API runtime tests for health, decision, relationship write audit, read-only mock connector discovery, native access, and reconciliation.
- CLI API smoke tests for operator, CI/CD, and assessor surfaces calling the API.

## Outstanding Requirements

- Implement a persistent relationship graph and policy model store.
- Replace the local in-memory API runtime with production-ready persistence and deployment packaging.
- Implement durable append-only audit storage with tamper-evidence and SIEM export.
- Add live read-only connector discovery for Entra ID, SharePoint, and AWS after connector security review.
- Persist discovery runs and native-grant readback outside the local in-memory store.
- Add dry-run provisioning and reconciliation job execution with queueing, retries, and dead-letter handling.
- Add controlled enforcement only after approval workflow, rollback, and connector least-privilege review are complete.
- Add ATO package generation for concrete system boundary diagrams, control implementation statements, POA&M inputs, and ConMon evidence.
`;

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, report, "utf8");
console.log(`Wrote ${reportPath}`);

if (failed.length > 0) {
  process.exitCode = 1;
}

function runPnpm(command: { name: string; args: string[] }): CommandResult {
  const result = run("corepack", ["pnpm", ...command.args]);
  return {
    name: command.name,
    command: `corepack pnpm ${command.args.join(" ")}`,
    status: result.exitCode === 0 ? "pass" : "fail",
    output: result.output
  };
}

function run(command: string, args: string[]): { exitCode: number; output: string } {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env
  });

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  };
}

function trimOutput(output: string): string {
  const maxLength = 5000;

  if (output.length <= maxLength) {
    return output;
  }

  return `${output.slice(0, maxLength)}\n... output truncated ...`;
}
