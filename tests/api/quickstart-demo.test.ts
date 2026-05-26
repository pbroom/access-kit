import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRebacApiServer } from "../../packages/api/src/index.js";
import { runQuickstartDemo, QUICKSTART_DEFAULT_API_KEY } from "../../scripts/quickstart-demo.js";

let server: Server | undefined;
let baseUrl = "";

beforeEach(async () => {
  server = createRebacApiServer({
    apiKeys: [QUICKSTART_DEFAULT_API_KEY],
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

describe("five-minute quickstart runner", () => {
  it("seeds the demo harness and verifies the first check and explain decisions", async () => {
    const logs: string[] = [];
    const result = await runQuickstartDemo({
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
      }
    });
    expect(result.decisions.map((decision) => decision.name)).toEqual([
      "quickstart-allow-case-plan",
      "quickstart-deny-default"
    ]);
    expect(result.decisions.map((decision) => decision.check.decision)).toEqual(["allow", "deny"]);
    expect(result.decisions.map((decision) => decision.explain.reasonCode)).toEqual([
      "ALLOW_VIA_RELATIONSHIP_PATH",
      "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
    ]);
    expect(result.auditEventCount).toBeGreaterThanOrEqual(15);
    expect(logs).toContain("quickstart-allow-case-plan: allow ALLOW_VIA_RELATIONSHIP_PATH");
    expect(logs).toContain("quickstart-deny-default: deny DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("is idempotent against an already-seeded local API", async () => {
    await runQuickstartDemo({ baseUrl, retries: 1, retryDelayMs: 1 });
    const second = await runQuickstartDemo({ baseUrl, retries: 1, retryDelayMs: 1 });

    expect(second.decisions.map((decision) => decision.check.decision)).toEqual(["allow", "deny"]);
  });
});
