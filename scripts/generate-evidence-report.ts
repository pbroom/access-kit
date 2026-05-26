import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { automationContract } from "./lib/automation-contract.js";

interface CommandResult {
  name: string;
  command: string;
  status: "pass" | "fail";
  output: string;
}

const root = process.cwd();
const reportPath = join(root, "reports/proof-point-validation.md");
const checkMode = process.argv.includes("--check");
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const vitestFileSummaryPattern = /^[^\n]*\.test\.ts \(\d+ tests?\)[^\n]*\n?/gm;
const vitestSlowTestPattern = /^[\s]*✓ .+ \d+ms\s*$/gm;
const commands = automationContract.evidence.commands;

const results = commands.map(runPnpm);
const branch = run("git", ["branch", "--show-current"]).output.trim();
const nodeVersion = run("node", ["--version"]).output.trim();
const pnpmVersion = run("corepack", ["pnpm", "--version"]).output.trim();
const generatedAt = new Date().toISOString();
const failed = results.filter((result) => result.status === "fail");

const report = buildReport({
  branch,
  failed,
  generatedAt,
  nodeVersion,
  pnpmVersion,
  results
});

if (checkMode) {
  const existingReport = await readFile(reportPath, "utf8").catch(() => "");
  const actual = normalizeReport(existingReport);
  const expected = normalizeReport(report);

  if (actual !== expected) {
    const diff = firstDifferentLine(actual, expected);
    console.error("Proof-point validation evidence is out of date. Run `pnpm evidence:generate`.");
    console.error(`First differing line ${diff.line}:`);
    console.error(`  committed: ${diff.actual}`);
    console.error(`  generated:  ${diff.expected}`);
    process.exitCode = 1;
  } else {
    console.log("Proof-point validation evidence is current.");
  }
} else {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report, "utf8");
  console.log(`Wrote ${reportPath}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}

function buildReport(input: {
  branch: string;
  failed: CommandResult[];
  generatedAt: string;
  nodeVersion: string;
  pnpmVersion: string;
  results: CommandResult[];
}): string {
  return `# Proof-Point Validation Evidence

Generated at: ${input.generatedAt}

Branch: ${input.branch}

Node: ${input.nodeVersion}

pnpm: ${input.pnpmVersion}

## Summary

${input.failed.length === 0 ? "All proof-point validation commands passed." : `${input.failed.length} proof-point validation command(s) failed.`}

| Proof point | Command | Result |
| --- | --- | --- |
${input.results.map((result) => `| ${result.name} | \`${result.command}\` | ${result.status.toUpperCase()} |`).join("\n")}

## Command Output

${input.results
    .map(
      (result) => `### ${result.name}

\`\`\`text
${trimOutput(result.output)}
\`\`\`
`
  )
  .join("\n")}

## Covered Proof Points

${automationContract.evidence.coveredProofPoints.map((proofPoint) => `- ${proofPoint}`).join("\n")}

## Outstanding Requirements

${automationContract.evidence.outstandingRequirements.map((requirement) => `- ${requirement}`).join("\n")}
`;
}

function runPnpm(command: { name: string; args: readonly string[] }): CommandResult {
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

function normalizeReport(report: string): string {
  return stripAnsi(report)
    .replace(/^Generated at:.*$/m, "Generated at: <generated-at>")
    .replace(/^Branch:.*$/m, "Branch: <branch>")
    .replace(/^Node:.*$/m, "Node: <node>")
    .replace(/^pnpm:.*$/m, "pnpm: <pnpm>")
    .replace(vitestFileSummaryPattern, "")
    .replace(vitestSlowTestPattern, "")
    .replace(/\/[^\s`]*access-kit[^\s`]*/g, "<repo>")
    .replace(/^[ ]*RUN[ ]{2}v.+$/gm, " RUN  v<vitest> <repo>")
    .replace(/^[ ]{3}Start at .+$/gm, "   Start at  <time>")
    .replace(/^[ ]{3}Duration .+$/gm, "   Duration  <duration>")
    .replace(/\n{3,}/g, "\n\n");
}

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern, "");
}

function firstDifferentLine(actual: string, expected: string): { line: number; actual: string; expected: string } {
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");
  const lineCount = Math.max(actualLines.length, expectedLines.length);

  for (let index = 0; index < lineCount; index += 1) {
    if (actualLines[index] !== expectedLines[index]) {
      return {
        line: index + 1,
        actual: actualLines[index] ?? "<missing>",
        expected: expectedLines[index] ?? "<missing>"
      };
    }
  }

  return { line: 0, actual: "<same>", expected: "<same>" };
}
