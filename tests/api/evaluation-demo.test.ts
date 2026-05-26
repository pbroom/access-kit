import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRebacApiServer } from "../../packages/api/src/index.js";
import { EVALUATION_DEFAULT_API_KEY, runEvaluationDemo } from "../../scripts/evaluation-demo.js";

let server: Server | undefined;
let baseUrl = "";

beforeEach(async () => {
  server = createRebacApiServer({
    apiKeys: [EVALUATION_DEFAULT_API_KEY],
    now: () => "2026-05-21T17:00:00.000Z"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (!server) {
    return;
  }

  server.close();
  await once(server, "close");
  server = undefined;
});

describe("thirty-minute evaluation demo runner", () => {
  it("runs the full local evaluation path against the HTTP API", async () => {
    const logs: string[] = [];
    const result = await runEvaluationDemo({
      baseUrl,
      log: (message) => logs.push(message),
      retries: 1,
      retryDelayMs: 1
    });

    expect(result).toMatchObject({
      harnessId: "demo-seed:local-rebac-v1",
      seedCounts: {
        subjects: 8,
        resources: 5,
        relationships: 10
      },
      policy: {
        status: "draft",
        validation: { valid: true },
        tests: { valid: true }
      }
    });
    expect(result.decisions.map((decision) => decision.name)).toEqual([
      "evaluation-write-case-plan",
      "evaluation-explicit-deny-restricted-notes",
      "evaluation-suspended-subject",
      "evaluation-owner-admin-case-plan"
    ]);
    expect(result.decisions.map((decision) => decision.check.decision)).toEqual(["allow", "deny", "deny", "allow"]);
    expect(result.decisions.map((decision) => decision.explain.reasonCode)).toEqual([
      "ALLOW_VIA_RELATIONSHIP_PATH",
      "DENY_EXPLICIT_OVERRIDE",
      "DENY_SUBJECT_NOT_ACTIVE",
      "ALLOW_VIA_RELATIONSHIP_PATH"
    ]);
    expect(result.provisioning.plan).toMatchObject({
      connectorId: "mock",
      mode: "dry_run",
      status: "planned"
    });
    expect(result.provisioning.job).toMatchObject({
      connectorId: "mock",
      dryRun: true,
      status: "completed",
      verification: {
        readbackState: {
          providerWrite: false
        }
      }
    });
    expect(result.connectorSync).toMatchObject({
      connectorId: "mock",
      mode: "read_only",
      evidence: {
        readOnly: true,
        nativeAccessReadback: true
      }
    });
    expect(result.reconciliation).toMatchObject({
      connectorId: "mock",
      dryRun: true,
      status: "completed",
      counts: {
        findings: 1,
        highOrCritical: 1
      }
    });
    expect(result.auditExport.exportedEventCount).toBeGreaterThan(0);
    expect(result.auditExport.auditIntegrity.status).toBe("verified");
    expect(result.evidenceExport.controls).toEqual(["AC-2", "AC-3", "AC-6", "AU-2", "AU-6", "CA-7", "CM-3"]);
    expect(result.evidenceExport.auditIntegrity.status).toBe("verified");
    expect(logs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^policy: policy:local-demo-rebac-policy:[a-z0-9]+ validated and proof-point tests passed$/)
    ]));
    expect(logs).toContain("evaluation-explicit-deny-restricted-notes: deny DENY_EXPLICIT_OVERRIDE");
    expect(logs).toContain("provisioning: planned plan, completed dry-run job");
  });

  it("is idempotent against an already-seeded evaluation API", async () => {
    await runEvaluationDemo({ baseUrl, retries: 1, retryDelayMs: 1 });
    const second = await runEvaluationDemo({ baseUrl, retries: 1, retryDelayMs: 1 });

    expect(second.decisions.map((decision) => decision.check.decision)).toEqual(["allow", "deny", "deny", "allow"]);
    expect(second.provisioning.job.status).toBe("completed");
    expect(second.reconciliation.counts.findings).toBe(1);
  });
});
