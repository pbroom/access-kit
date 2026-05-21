import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
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
});

async function runCli(...args: string[]): Promise<void> {
  const program = buildCli({
    apiUrl: baseUrl,
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
