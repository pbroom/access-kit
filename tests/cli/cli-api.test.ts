import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPolicyModel } from "../../packages/core/src/index.js";
import { createRebacApiServer } from "../../packages/api/src/index.js";
import { buildCli, CLI_EXIT_CODES } from "../../packages/cli/src/index.js";

let server: Server;
let baseUrl: string;
let output: unknown[];
const tempDirs: string[] = [];

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
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CLI API wrapper", () => {
  it("checks API readiness and emits JSON output", async () => {
    await runCli("ready");

    expect(lastOutput()).toMatchObject({
      status: "ready_with_warnings",
      version: "0.1.0",
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "api_runtime", status: "pass" })
      ])
    });
  });

  it("uses API failure exit code when readiness is not accepted", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const program = buildCli({
      apiUrl: baseUrl,
      fetch: async () =>
        new Response(JSON.stringify({ status: "not_ready" }), {
          status: 503,
          headers: { "content-type": "application/json" }
        }),
      writeJson: (value) => output.push(value)
    });
    program.exitOverride();

    try {
      await expect(program.parseAsync(["node", "rebac", "ready"])).resolves.toBe(program);
      expect(process.exitCode).toBe(CLI_EXIT_CODES.apiFailure);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("API request failed: 503"));
      expect(output).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("runs check through the API", async () => {
    await runCli("check", "user:alice", "read", "document:case-plan");

    expect(lastOutput()).toMatchObject({
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
    });
  });

  it("sets a relationship through the API and affects later decisions", async () => {
    await runCli("relation", "set", "user:alice", "denied", "document:case-plan");
    await runCli("explain", "user:alice", "read", "document:case-plan");

    expect(lastOutput()).toMatchObject({
      decision: "deny",
      reasonCode: "DENY_EXPLICIT_OVERRIDE"
    });
  });

  it("keeps relationship ids distinct for tuples that sanitize to the same text", async () => {
    await runCli("relation", "set", "user:alice", "denied", "document:case-plan");
    await runCli("relation", "set", "user:alice:denied", "document", "case-plan");
    await runCli("explain", "user:alice", "read", "document:case-plan");

    expect(lastOutput()).toMatchObject({
      decision: "deny",
      reasonCode: "DENY_EXPLICIT_OVERRIDE"
    });
  });

  it("runs mock connector sync through the API", async () => {
    await runCli("connector", "sync", "mock", "--mode", "read_only");

    expect(lastOutput()).toMatchObject({
      connectorId: "mock",
      mode: "read_only",
      status: "completed_with_warnings",
      counts: {
        subjects: 3,
        nativeGrants: 4,
        warnings: 1
      }
    });
  });

  it("inspects observed native access through the API", async () => {
    await runCli("connector", "sync", "mock", "--mode", "read_only");
    await runCli("resource", "native-access", "document:case-plan", "--connector", "mock");

    expect(lastOutput()).toEqual(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          targetObjectId: "document:case-plan",
          subjectId: "user:alice",
          principalType: "user",
          nativePermission: "read",
          grantType: "direct",
          sourceConnectorId: "mock"
        })
      ])
    }));
  });

  it("forwards reconcile findings severity to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "reconcile", "findings", "--severity", "high");

    expect(requests.at(-1)?.url).toContain("/v1/reconciliation/findings?severity=high");
  });

  it("runs reconciliation in dry-run mode by default", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "reconcile", "run", "--connector", "mock");

    expect(requests.at(-1)?.body).toEqual({ connectorId: "mock", dryRun: true });
  });

  it("forwards scheduled reconciliation and remediation dry-run evidence to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "reconcile",
      "run",
      "--connector",
      "mock",
      "--scheduled",
      "--cadence",
      "daily",
      "--scheduled-at",
      "2026-05-21T17:00:00.000Z"
    );
    await runCliWithFetch(
      requests,
      "reconcile",
      "remediate",
      "--finding",
      "drift:001",
      "--change-ticket",
      "chg:drift-001",
      "--readiness-report",
      "readiness:mock:drift",
      "--ticket",
      "chg:drift-001",
      "--siem",
      "siem:drift-001"
    );

    expect(requests[0]?.body).toEqual({
      connectorId: "mock",
      dryRun: true,
      trigger: "scheduled",
      schedule: {
        cadence: "daily",
        scheduledAt: "2026-05-21T17:00:00.000Z"
      }
    });
    expect(requests[1]?.url).toBe("http://api.example/v1/reconciliation/findings/drift%3A001/remediation");
    expect(requests[1]?.body).toMatchObject({
      approval: {
        decision: "approved",
        approverId: "user:cli-operator",
        changeTicket: "chg:drift-001",
        approvedAt: "2026-05-21T17:00:00.000Z"
      },
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["revoke", "repair", "review"],
        maxSeverity: "high",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false
      },
      readinessReportId: "readiness:mock:drift",
      hookEvidence: [
        { system: "ticket", referenceId: "chg:drift-001", status: "linked", recordedAt: "2026-05-21T17:00:00.000Z" },
        { system: "siem", referenceId: "siem:drift-001", status: "notified", recordedAt: "2026-05-21T17:00:00.000Z" }
      ]
    });
  });

  it("creates a targeted revocation plan for a native grant", async () => {
    await runCli("provision", "revoke", "native-grant:document:case-plan:alice");

    expect(lastOutput()).toMatchObject({
      id: "plan:revoke:native-grant:document:case-plan:alice",
      subjectId: "user:alice",
      resourceId: "document:case-plan",
      action: "read",
      actions: [
        {
          operation: "revoke",
          requestedState: {
            nativeGrantId: "native-grant:document:case-plan:alice",
            status: "revoked"
          }
        }
      ]
    });
  });

  it("applies provisioning plans through the API", async () => {
    await runCli("provision", "plan", "user:alice", "document:case-plan", "read");
    const plan = lastOutput();

    await runCli("provision", "apply", String(plan.id));

    expect(lastOutput()).toMatchObject({
      planId: plan.id,
      approverId: "user:cli-operator",
      status: "completed",
      dryRun: true,
      actionResults: [
        expect.objectContaining({
          status: "skipped"
        })
      ]
    });
  });

  it("forwards native access filters to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "resource",
      "native-access",
      "document:case-plan",
      "--connector",
      "mock",
      "--subject",
      "user:alice",
      "--permission",
      "read",
      "--grant-type",
      "direct",
      "--principal-type",
      "user"
    );

    expect(requests.at(-1)?.url).toBe(
      "http://api.example/v1/resources/document%3Acase-plan/native-access?connectorId=mock&subjectId=user%3Aalice&nativePermission=read&grantType=direct&principalType=user"
    );
  });

  it("forwards discovery run filters to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "discovery",
      "runs",
      "--connector",
      "sharepoint-readonly",
      "--status",
      "completed_with_warnings"
    );

    expect(requests.at(-1)?.url).toBe(
      "http://api.example/v1/discovery/runs?connectorId=sharepoint-readonly&status=completed_with_warnings"
    );
  });

  it("reports unsupported connector sync modes through the CLI", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await runCli("connector", "sync", "mock", "--mode", "enforcement");

      expect(process.exitCode).toBe(CLI_EXIT_CODES.apiFailure);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("UNSUPPORTED_CONNECTOR_MODE"));
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("passes connector and dry-run fields for provisioning commands", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "provision", "plan", "user:alice", "document:case-plan", "read", "--connector", "mock");
    await runCliWithFetch(requests, "provision", "apply", "plan:mock:decision");

    expect(requests[0]?.body).toEqual({
      subjectId: "user:alice",
      resourceId: "document:case-plan",
      action: "read",
      connectorId: "mock",
      mode: "dry_run",
      dryRun: true
    });
    expect(requests[1]?.body).toEqual({
      planId: "plan:mock:decision",
      approverId: "user:cli-operator",
      mode: "dry_run",
      dryRun: true
    });
  });

  it("forwards controlled-enforcement approval and guardrail fields", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      {
        now: () => "2026-05-21T17:00:00.000Z"
      },
      "provision",
      "plan",
      "user:alice",
      "document:case-plan",
      "read",
      "--connector",
      "mock",
      "--mode",
      "enforcement",
      "--approver",
      "user:approver",
      "--change-ticket",
      "chg:phase4",
      "--readiness-report",
      "readiness:mock:phase4",
      "--synthetic-only",
      "--reason",
      "Synthetic controlled enforcement proof point"
    );
    await runCliWithFetch(
      requests,
      {
        now: () => "2026-05-21T17:00:00.000Z"
      },
      "provision",
      "apply",
      "plan:mock:decision",
      "--mode",
      "enforcement",
      "--approver",
      "user:approver",
      "--change-ticket",
      "chg:phase4",
      "--synthetic-only",
      "--reason",
      "Synthetic controlled enforcement proof point"
    );

    expect(requests[0]?.body).toEqual({
      subjectId: "user:alice",
      resourceId: "document:case-plan",
      action: "read",
      connectorId: "mock",
      mode: "enforcement",
      dryRun: false,
      approval: {
        decision: "approved",
        approverId: "user:approver",
        changeTicket: "chg:phase4",
        approvedAt: "2026-05-21T17:00:00.000Z",
        reason: "Synthetic controlled enforcement proof point"
      },
      readinessReportId: "readiness:mock:phase4",
      control: {
        syntheticOnly: true,
        liveProviderWrites: false,
        incidentMode: false,
        breakGlass: false
      }
    });
    expect(requests[1]?.body).toEqual({
      planId: "plan:mock:decision",
      approverId: "user:approver",
      mode: "enforcement",
      dryRun: false,
      approval: {
        decision: "approved",
        approverId: "user:approver",
        changeTicket: "chg:phase4",
        approvedAt: "2026-05-21T17:00:00.000Z",
        reason: "Synthetic controlled enforcement proof point"
      },
      control: {
        syntheticOnly: true,
        liveProviderWrites: false,
        incidentMode: false,
        breakGlass: false
      }
    });
  });

  it("requires explicit approval, readiness, and confirmation for emergency revoke", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      {
        now: () => "2026-05-21T17:00:00.000Z"
      },
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

    expect(requests.at(-1)?.url).toBe("http://api.example/v1/provisioning/plans");
    expect(requests.at(-1)?.headers["idempotency-key"]).toMatch(/^idem:cli:post:/);
    expect(requests.at(-1)?.body).toEqual({
      grantId: "native-grant:document:case-plan:alice",
      connectorId: "mock",
      action: "revoke",
      mode: "enforcement",
      dryRun: false,
      approval: {
        decision: "approved",
        approverId: "user:incident-commander",
        changeTicket: "inc:2026-05-21:001",
        approvedAt: "2026-05-21T17:00:00.000Z",
        reason: "Approved emergency revocation exercise"
      },
      readinessReportId: "readiness:mock:phase4",
      control: {
        syntheticOnly: true,
        liveProviderWrites: false,
        incidentMode: false,
        breakGlass: false
      }
    });
  });

  it("keeps emergency revoke idempotency stable across retries with fresh approval timestamps", async () => {
    const requests: CapturedRequest[] = [];
    const now = sequenceNow("2026-05-21T17:00:00.000Z", "2026-05-21T17:00:01.000Z");
    const args = [
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
    ];

    await runCliWithFetch(requests, { now }, ...args);
    await runCliWithFetch(requests, { now }, ...args);

    expect(requests[0]?.body).toMatchObject({ approval: { approvedAt: "2026-05-21T17:00:00.000Z" } });
    expect(requests[1]?.body).toMatchObject({ approval: { approvedAt: "2026-05-21T17:00:01.000Z" } });
    expect(requests[0]?.headers["idempotency-key"]).toBe(requests[1]?.headers["idempotency-key"]);
  });

  it("changes emergency revoke idempotency when non-volatile approval evidence changes", async () => {
    const requests: CapturedRequest[] = [];
    const baseArgs = [
      "emergency",
      "revoke",
      "native-grant:document:case-plan:alice",
      "--connector",
      "mock",
      "--readiness-report",
      "readiness:mock:phase4",
      "--reason",
      "Approved emergency revocation exercise",
      "--confirm-revoke"
    ];

    await runCliWithFetch(
      requests,
      { now: () => "2026-05-21T17:00:00.000Z" },
      ...baseArgs,
      "--approver",
      "user:incident-commander",
      "--change-ticket",
      "inc:2026-05-21:001"
    );
    await runCliWithFetch(
      requests,
      { now: () => "2026-05-21T17:00:01.000Z" },
      ...baseArgs,
      "--approver",
      "user:secondary-approver",
      "--change-ticket",
      "inc:2026-05-21:001"
    );

    expect(requests[0]?.body).toMatchObject({ approval: { approverId: "user:incident-commander" } });
    expect(requests[1]?.body).toMatchObject({ approval: { approverId: "user:secondary-approver" } });
    expect(requests[0]?.headers["idempotency-key"]).not.toBe(requests[1]?.headers["idempotency-key"]);
  });

  it("fails closed before API calls when emergency revoke is not confirmed", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const requests: CapturedRequest[] = [];

    try {
      await runCliWithFetch(
        requests,
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
        "Approved emergency revocation exercise"
      );

      expect(process.exitCode).toBe(CLI_EXIT_CODES.configuration);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("emergency revoke requires --confirm-revoke"));
      expect(requests).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("fails closed when emergency revoke readiness evidence is not accepted by the API", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await runCli(
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
        "readiness:mock:missing",
        "--reason",
        "Approved emergency revocation exercise",
        "--confirm-revoke"
      );

      const stderr = errorSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(process.exitCode).toBe(CLI_EXIT_CODES.apiFailure);
      expect(stderr).toContain("ENFORCEMENT_READINESS_NOT_FOUND");
      expect(output).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("forwards connector enforcement readiness checks to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "connector",
      "readiness",
      "mock",
      "--mode",
      "enforcement",
      "--synthetic-only",
      "--approver-role",
      "access-approver",
      "--change-ticket-pattern",
      "^chg:[a-z0-9_:-]+$"
    );
    await runCliWithFetch(requests, "connector", "readiness", "mock", "--status", "ready");

    expect(requests[0]?.url).toBe("http://api.example/v1/connectors/mock/enforcement-readiness");
    expect(requests[0]?.body).toEqual({
      mode: "enforcement",
      control: {
        syntheticOnly: true,
        liveProviderWrites: false,
        incidentMode: false,
        breakGlass: false
      },
      requiredApproverRole: "access-approver",
      changeTicketPattern: "^chg:[a-z0-9_:-]+$"
    });
    expect(requests[1]?.url).toBe("http://api.example/v1/connectors/mock/enforcement-readiness?status=ready");
  });

  it("sends distinct idempotency keys for different mutations", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "relation", "set", "user:alice", "member_of", "group:one");
    await runCliWithFetch(requests, "relation", "set", "user:bob", "member_of", "group:two");

    const keys = requests.map((request) => request.headers["idempotency-key"]);
    expect(keys[0]).toMatch(/^idem:cli:put:/);
    expect(keys[1]).toMatch(/^idem:cli:put:/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("sends stable idempotency keys for retried mutations", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "provision", "apply", "plan:mock:decision");
    await runCliWithFetch(requests, "provision", "apply", "plan:mock:decision");

    expect(requests[0]?.headers["idempotency-key"]).toBe(requests[1]?.headers["idempotency-key"]);
  });

  it("uses one timestamp for relationship asserted and created times", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      {
        now: sequenceNow("2026-05-21T17:00:00.000Z", "2026-05-21T17:00:01.000Z")
      },
      "relation",
      "set",
      "user:alice",
      "member_of",
      "group:case-team"
    );

    expect(requests.at(-1)?.body).toMatchObject({
      assertedAt: "2026-05-21T17:00:00.000Z",
      createdAt: "2026-05-21T17:00:00.000Z"
    });
  });

  it("omits the audit search query marker when no filters are set", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "audit", "search");

    expect(requests.at(-1)?.url).toBe("http://api.example/v1/audit/events");
  });

  it("forwards audit integrity checks to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "audit", "integrity");

    expect(requests.at(-1)?.url).toBe("http://api.example/v1/audit/integrity");
  });

  it("forwards audit export windows and targets to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "audit",
      "export",
      "--from",
      "2026-05-21T00:00:00.000Z",
      "--to",
      "2026-05-22T00:00:00.000Z",
      "--target",
      "operator_download"
    );

    expect(requests.at(-1)?.url).toBe(
      "http://api.example/v1/audit/export?from=2026-05-21T00%3A00%3A00.000Z&to=2026-05-22T00%3A00%3A00.000Z&target=operator_download"
    );
  });

  it("forwards ATO evidence export windows to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "evidence",
      "export",
      "--framework",
      "fedramp-rev5",
      "--controls",
      "AC-3,AU-6",
      "--from",
      "2026-05-21T00:00:00.000Z",
      "--to",
      "2026-05-22T00:00:00.000Z",
      "--format",
      "markdown"
    );

    expect(requests.at(-1)?.url).toBe(
      "http://api.example/v1/evidence/export?framework=fedramp-rev5&controls=AC-3%2CAU-6&format=markdown&from=2026-05-21T00%3A00%3A00.000Z&to=2026-05-22T00%3A00%3A00.000Z"
    );
  });

  it("forwards signed evidence package verification to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "evidence",
      "verify",
      "--package",
      "tests/fixtures/schema-examples/evidence-export.json"
    );

    expect(requests.at(-1)?.url).toBe("http://api.example/v1/evidence/verify");
    expect(requests.at(-1)?.body).toEqual(expect.objectContaining({
      exportId: "evidence:may-2026-ac-au",
      signedPackage: expect.objectContaining({ version: "signed-evidence-package:v1" })
    }));
  });

  it("uses CLI profiles and environment-backed bearer tokens", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rebac-cli-profile-"));
    tempDirs.push(tempDir);
    const configPath = join(tempDir, "profiles.json");
    await writeFile(configPath, JSON.stringify({
      profiles: {
        local: {
          apiUrl: "http://profile.example",
          apiKeyEnv: "REBAC_PROFILE_TOKEN"
        }
      }
    }));
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      {
        env: {
          REBAC_PROFILE_TOKEN: "profile-token"
        }
      },
      "--config",
      configPath,
      "--profile",
      "local",
      "connector",
      "list"
    );

    expect(requests.at(-1)?.url).toBe("http://profile.example/v1/connectors");
    expect(requests.at(-1)?.headers.authorization).toBe("Bearer profile-token");
  });

  it("previews mutating commands with stable diff output without calling the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(
      requests,
      "--preview",
      "--diff",
      "provision",
      "plan",
      "user:alice",
      "document:case-plan",
      "read",
      "--connector",
      "mock"
    );

    expect(requests).toEqual([]);
    expect(lastOutput()).toMatchObject({
      mode: "preview",
      apiUrl: "http://api.example",
      method: "POST",
      path: "/v1/provisioning/plans",
      idempotencyKey: expect.stringMatching(/^idem:cli:post:/),
      body: {
        subjectId: "user:alice",
        resourceId: "document:case-plan",
        action: "read",
        connectorId: "mock",
        mode: "dry_run",
        dryRun: true
      },
      diff: expect.arrayContaining([
        "+ POST /v1/provisioning/plans",
        expect.stringContaining("\"subjectId\": \"user:alice\"")
      ])
    });
  });

  it("rejects request diffs without preview before calling the API", async () => {
    const requests: CapturedRequest[] = [];
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await runCliWithFetch(
        requests,
        "--diff",
        "provision",
        "plan",
        "user:alice",
        "document:case-plan",
        "read",
        "--connector",
        "mock"
      );

      expect(requests).toEqual([]);
      expect(process.exitCode).toBe(CLI_EXIT_CODES.configuration);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--diff requires --preview"));
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("prints shell completion without calling the API", async () => {
    const textOutput: string[] = [];
    const program = buildCli({
      apiUrl: "http://api.example",
      writeJson: (value) => output.push(value),
      writeText: (value) => textOutput.push(value)
    });
    program.exitOverride();

    await program.parseAsync(["node", "rebac", "completion", "bash"]);

    expect(output).toEqual([]);
    expect(textOutput.join("\n")).toContain("complete -F _rebac_completion rebac");
  });

  it("reports unsupported completion shells with the configuration exit code", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const program = buildCli({
      apiUrl: "http://api.example",
      writeJson: (value) => output.push(value)
    });
    program.exitOverride();

    try {
      await expect(program.parseAsync(["node", "rebac", "completion", "powershell"])).resolves.toBe(program);
      expect(process.exitCode).toBe(CLI_EXIT_CODES.configuration);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("completion shell must be bash, zsh, or fish"));
      expect(output).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("escapes fish completion words before shell rendering", async () => {
    const textOutput: string[] = [];
    const program = buildCli({
      apiUrl: "http://api.example",
      writeJson: (value) => output.push(value),
      writeText: (value) => textOutput.push(value)
    });
    program.exitOverride();
    program.command("debug\\'token");

    await program.parseAsync(["node", "rebac", "completion", "fish"]);

    expect(output).toEqual([]);
    expect(textOutput.join("\n")).toContain("complete -c rebac -f -a 'debug\\\\'\\''token'");
  });

  it("uses explicit exit codes for API and configuration failures", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const program = buildCli({
      apiUrl: baseUrl,
      writeJson: (value) => output.push(value)
    });
    program.exitOverride();

    try {
      await expect(program.parseAsync(["node", "rebac", "--profile", "missing", "connector", "list"])).resolves.toBe(program);
      expect(process.exitCode).toBe(CLI_EXIT_CODES.configuration);

      process.exitCode = previousExitCode;
      errorSpy.mockClear();
      await expect(program.parseAsync(["node", "rebac", "connector", "sync", "mock", "--mode", "enforcement"])).resolves.toBe(program);
      expect(process.exitCode).toBe(CLI_EXIT_CODES.apiFailure);

    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("distinguishes policy validate from policy test payloads", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "policy", "validate", "policy:model");
    await runCliWithFetch(requests, "policy", "test", "policy:tests");

    expect(requests[0]?.body).toEqual({ mode: "validate", policyFile: "policy:model" });
    expect(requests[1]?.body).toEqual({ mode: "test", testFile: "policy:tests" });
  });

  it("runs policy commands through the local API", async () => {
    const created = await createPolicyForCli("cli model");
    const policyId = String(created.id);

    await runCli("policy", "validate", policyId);
    expect(lastOutput()).toMatchObject({
      valid: true,
      checks: expect.arrayContaining([
        { name: "schema_version", status: "pass", message: expect.any(String) },
        { name: "tenant_boundary_fail_closed", status: "pass", message: expect.any(String) }
      ])
    });

    await runCli("policy", "publish", policyId, "--change-ticket", "chg:policy");
    expect(lastOutput()).toMatchObject({
      id: policyId,
      status: "published",
      publishedAt: expect.any(String)
    });
  });

  it("fails closed when publishing an unvalidated policy through the CLI", async () => {
    const created = await createPolicyForCli("cli unvalidated model");
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await runCli("policy", "publish", String(created.id), "--change-ticket", "chg:policy");
      const stderr = errorSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(process.exitCode).toBe(CLI_EXIT_CODES.apiFailure);
      expect(stderr).toContain("POLICY_NOT_VALIDATED");
      expect(output).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("reports API failures through Commander errors instead of raw rejections", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const program = buildCli({
      apiUrl: baseUrl,
      fetch: async () =>
        new Response(JSON.stringify({ code: "BROKEN", message: "nope" }), {
          status: 500,
          headers: { "content-type": "application/json" }
        }),
      writeJson: (value) => output.push(value)
    });
    program.exitOverride();

    try {
      await expect(program.parseAsync(["node", "rebac", "check", "user:alice", "read", "document:case-plan"])).resolves.toBe(program);
      expect(process.exitCode).toBe(CLI_EXIT_CODES.apiFailure);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("API request failed"));
      expect(output).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });

  it("reports non-JSON API failures without masking the response body", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const program = buildCli({
      apiUrl: baseUrl,
      fetch: async () =>
        new Response("temporarily unavailable", {
          status: 503,
          headers: { "content-type": "text/plain" }
        }),
      writeJson: (value) => output.push(value)
    });
    program.exitOverride();

    try {
      await expect(program.parseAsync(["node", "rebac", "check", "user:alice", "read", "document:case-plan"])).resolves.toBe(program);
      const stderr = errorSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(process.exitCode).toBe(CLI_EXIT_CODES.apiFailure);
      expect(stderr).toContain("API request failed: 503");
      expect(stderr).toContain("temporarily unavailable");
      expect(stderr).not.toContain("Unexpected token");
      expect(output).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
    }
  });
});

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

async function runCli(...args: string[]): Promise<void> {
  const program = buildCli({
    apiUrl: baseUrl,
    writeJson: (value) => output.push(value),
    now: () => "2026-05-21T17:00:00.000Z"
  });
  program.exitOverride();
  await program.parseAsync(["node", "rebac", ...args]);
}

interface RunCliOptions {
  now?: () => string;
  env?: NodeJS.ProcessEnv;
}

async function runCliWithFetch(requests: CapturedRequest[], ...args: string[]): Promise<void>;
async function runCliWithFetch(requests: CapturedRequest[], options: RunCliOptions, ...args: string[]): Promise<void>;
async function runCliWithFetch(
  requests: CapturedRequest[],
  optionsOrFirstArg: RunCliOptions | string,
  ...rest: string[]
): Promise<void> {
  const options = typeof optionsOrFirstArg === "string" ? {} : optionsOrFirstArg;
  const args = typeof optionsOrFirstArg === "string" ? [optionsOrFirstArg, ...rest] : rest;
  const program = buildCli({
    apiUrl: "http://api.example",
    env: options.env ?? process.env,
    fetch: async (input, init) => {
      const headers = init?.headers as Record<string, string>;
      requests.push({
        url: String(input),
        headers,
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    writeJson: (value) => output.push(value),
    now: options.now ?? (() => "2026-05-21T17:00:00.000Z")
  });
  program.exitOverride();
  await program.parseAsync(["node", "rebac", ...args]);
}

function sequenceNow(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[index++] ?? timestamps.at(-1) ?? "2026-05-21T17:00:00.000Z";
}

async function createPolicyForCli(name: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/v1/policies`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `idem-cli-policy-${name}` },
    body: JSON.stringify({
      name,
      model: createDefaultPolicyModel(),
      tests: [{ name: "cli policy smoke" }]
    })
  });

  expect(response.ok).toBe(true);
  return response.json() as Promise<Record<string, unknown>>;
}

function lastOutput(): Record<string, unknown> {
  const value = output.at(-1);

  if (!value || typeof value !== "object") {
    throw new Error("Expected CLI command to write a JSON object");
  }

  return value as Record<string, unknown>;
}
