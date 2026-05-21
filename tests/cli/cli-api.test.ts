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

  it("runs mock connector sync through the API", async () => {
    await runCli("connector", "sync", "mock", "--mode", "read_only");

    expect(lastOutput()).toMatchObject({
      connectorId: "mock",
      mode: "read_only",
      subjects: 1
    });
  });

  it("forwards reconcile findings severity to the API", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "reconcile", "findings", "--severity", "high");

    expect(requests.at(-1)?.url).toContain("/v1/reconciliation/findings?severity=high");
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

  it("distinguishes policy validate from policy test payloads", async () => {
    const requests: CapturedRequest[] = [];

    await runCliWithFetch(requests, "policy", "validate", "policy:model");
    await runCliWithFetch(requests, "policy", "test", "policy:tests");

    expect(requests[0]?.body).toEqual({ mode: "validate", policyFile: "policy:model" });
    expect(requests[1]?.body).toEqual({ mode: "test", testFile: "policy:tests" });
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

async function runCliWithFetch(requests: CapturedRequest[], ...args: string[]): Promise<void> {
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
    now: () => "2026-05-21T17:00:00.000Z"
  });
  program.exitOverride();
  await program.parseAsync(["node", "rebac", ...args]);
}

function lastOutput(): Record<string, unknown> {
  const value = output.at(-1);

  if (!value || typeof value !== "object") {
    throw new Error("Expected CLI command to write a JSON object");
  }

  return value as Record<string, unknown>;
}
