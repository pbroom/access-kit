import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRebacApiServer } from "../../packages/api/src/index.js";
import { buildCli } from "../../packages/cli/src/index.js";

let server: Server;
let baseUrl: string;
let output: unknown[];

beforeEach(async () => {
  output = [];
  server = createRebacApiServer({ now: () => "2026-05-21T17:00:00.000Z" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  server.close();
  await once(server, "close");
});

describe("documentation CLI examples", () => {
  it("executes the synthetic operator and assessor walkthrough against the local API", async () => {
    await runCli("ready");
    expect(lastOutput()).toMatchObject({
      status: "ready_with_warnings",
      checks: expect.arrayContaining([expect.objectContaining({ name: "api_runtime" })])
    });

    await runCli("connector", "list");
    expect(lastOutput()).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: "mock" })])
    });

    await runCli("connector", "test", "mock");
    expect(lastOutput()).toMatchObject({ valid: true });

    await runCli("connector", "sync", "mock", "--mode", "read_only");
    const discoveryRun = lastOutput();
    expect(discoveryRun).toMatchObject({
      id: expect.any(String),
      connectorId: "mock",
      mode: "read_only",
      status: "completed_with_warnings"
    });

    await runCli("discovery", "runs", "--connector", "mock");
    expect(lastOutput()).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: discoveryRun.id })])
    });

    await runCli("check", "user:alice", "read", "document:case-plan");
    expect(lastOutput()).toMatchObject({
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
    });

    await runCli("explain", "user:alice", "read", "document:case-plan");
    expect(lastOutput()).toMatchObject({
      decision: "allow",
      relationshipPath: expect.arrayContaining([
        expect.objectContaining({ subjectId: "user:alice", relation: "member_of" })
      ])
    });

    await runCli("resource", "native-access", "document:case-plan", "--connector", "mock", "--subject", "user:alice");
    expect(lastOutput()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          targetObjectId: "document:case-plan",
          subjectId: "user:alice",
          nativePermission: "read"
        })
      ])
    });

    await runCli("provision", "revoke", "native-grant:document:case-plan:alice", "--connector", "mock");
    const revocationPlan = lastOutput();
    expect(revocationPlan).toMatchObject({
      id: expect.any(String),
      connectorId: "mock",
      action: "read",
      actions: [expect.objectContaining({ operation: "revoke" })]
    });

    await runCli("provision", "apply", String(revocationPlan.id));
    expect(lastOutput()).toMatchObject({
      planId: revocationPlan.id,
      status: "completed",
      dryRun: true
    });

    await runCli("reconcile", "run", "--connector", "mock", "--dry-run");
    expect(lastOutput()).toMatchObject({
      status: "completed",
      counts: { findings: 1, highOrCritical: 1 }
    });

    await runCli("reconcile", "findings", "--severity", "high");
    expect(lastOutput()).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ severity: "high" })])
    });

    await runCli("audit", "integrity");
    expect(lastOutput()).toMatchObject({
      status: "verified",
      findings: []
    });

    await runCli(
      "audit",
      "export",
      "--from",
      "2026-05-01T00:00:00.000Z",
      "--to",
      "2026-05-31T23:59:59.000Z",
      "--target",
      "operator_download"
    );
    expect(lastOutput()).toMatchObject({
      format: "jsonl",
      target: "operator_download"
    });

    await runCli(
      "evidence",
      "export",
      "--framework",
      "nist-800-53",
      "--controls",
      "AC-2,AC-3,AU-2,AU-6,CA-7",
      "--from",
      "2026-05-01T00:00:00.000Z",
      "--to",
      "2026-05-31T23:59:59.000Z",
      "--format",
      "json"
    );
    expect(lastOutput()).toMatchObject({
      framework: "nist-800-53",
      controls: expect.arrayContaining(["AC-2", "AC-3", "AU-2", "AU-6", "CA-7"]),
      format: "json"
    });

    await runCli(
      "--preview",
      "--diff",
      "emergency",
      "revoke",
      "native-grant:document:case-plan:alice",
      "--connector",
      "mock",
      "--approver",
      "user:incident-commander",
      "--change-ticket",
      "inc:2026-05-21:001",
      "--readiness-report",
      "readiness:mock:phase4",
      "--reason",
      "Approved emergency revocation exercise",
      "--confirm-revoke"
    );
    expect(lastOutput()).toMatchObject({
      mode: "preview",
      method: "POST",
      path: "/v1/provisioning/plans",
      idempotencyKey: expect.stringMatching(/^idem:cli:post:/),
      body: {
        action: "revoke",
        mode: "enforcement",
        dryRun: false,
        readinessReportId: "readiness:mock:phase4"
      }
    });
  });
});

async function runCli(...args: string[]): Promise<void> {
  output = [];
  const program = buildCli({
    apiUrl: baseUrl,
    writeJson: (value) => output.push(value),
    now: () => "2026-05-21T17:00:00.000Z"
  });
  program.exitOverride();
  await program.parseAsync(["node", "rebac", ...args]);

  if (output.length !== 1) {
    throw new Error(`Expected CLI command to write exactly one JSON object, got ${output.length}: ${args.join(" ")}`);
  }
}

function lastOutput(): Record<string, unknown> {
  const value = output.at(-1);

  if (!value || typeof value !== "object") {
    throw new Error("Expected CLI command to write a JSON object");
  }

  return value as Record<string, unknown>;
}
