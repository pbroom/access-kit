import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("CLI API wrapper", () => {
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

      expect(process.exitCode).toBe(1);
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
      "--synthetic-only"
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
        approvedAt: "2026-05-21T17:00:00.000Z"
      },
      control: {
        syntheticOnly: true,
        liveProviderWrites: false,
        incidentMode: false,
        breakGlass: false
      }
    });
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

  it("distinguishes policy validate from policy test payloads", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "policy", "validate", "policy:model");
    await runCliWithFetch(requests, "policy", "test", "policy:tests");

    expect(requests[0]?.body).toEqual({ mode: "validate", policyFile: "policy:model" });
    expect(requests[1]?.body).toEqual({ mode: "test", testFile: "policy:tests" });
  });

  it("runs policy commands through the local API", async () => {
    await runCli("policy", "validate", "policy:model");
    expect(lastOutput()).toMatchObject({
      policyId: "policy:model",
      mode: "validate",
      status: "valid"
    });

    await runCli("policy", "publish", "policy:model", "--change-ticket", "chg:policy");
    expect(lastOutput()).toMatchObject({
      policyId: "policy:model",
      status: "published",
      changeTicket: "chg:policy",
      approverId: "user:cli-operator"
    });
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
      expect(process.exitCode).toBe(1);
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
      expect(process.exitCode).toBe(1);
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

function lastOutput(): Record<string, unknown> {
  const value = output.at(-1);

  if (!value || typeof value !== "object") {
    throw new Error("Expected CLI command to write a JSON object");
  }

  return value as Record<string, unknown>;
}
