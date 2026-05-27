import { once } from "node:events";
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRebacApiServer } from "../../packages/api/src/index.js";
import { createDefaultPolicyModel, createDemoSeedData } from "../../packages/core/src/index.js";

const apiKey = "local-python-pep-key";
const exampleDir = join(process.cwd(), "examples", "python-fastapi-pep");
let server: Server | undefined;
let baseUrl: string;

beforeEach(async () => {
  server = createRebacApiServer({ apiKeys: [apiKey], seed: createDemoSeedData() });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    server = undefined;
  }
});

describe("Python client and FastAPI PEP starter", () => {
  it("passes the Python PEP conformance tests", async () => {
    const result = await spawnPython(["-m", "unittest", "discover", "-s", exampleDir, "-p", "test_*.py"]);

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("OK");
  });

  it("checks and explains decisions against the local API", async () => {
    const script = `
import json
from access_kit_pep import AccessKitClient

client = AccessKitClient(base_url="${baseUrl}", api_key="${apiKey}")
request = {"subjectId": "user:alice", "action": "read", "resourceId": "document:case-plan"}
check = client.check(request, correlation_id="corr:python-pep-check")
explain = client.explain(request, correlation_id="corr:python-pep-explain")

assert check["decision"] == "allow"
assert check["relationshipPath"] == []
assert explain["decision"] == "allow"
assert len(explain["relationshipPath"]) > 0

print(json.dumps({"check": check["reasonCode"], "explainPathLength": len(explain["relationshipPath"])}))
`;
    const result = await spawnPython(["-c", script]);

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("ALLOW_VIA_RELATIONSHIP_PATH");
  });

  it("runs the Python policy-test CI example against the local API", async () => {
    const draft = await createPolicy({
      name: "python pep starter policy",
      model: createDefaultPolicyModel(),
      tests: [{ name: "python pep starter proof points" }]
    });
    const result = await spawnPython([join(exampleDir, "policy_test_ci.py"), draft.id]);

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain(`PASS ${draft.id} policy-test checks.`);
  });
});

async function createPolicy(body: unknown): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/v1/policies`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem:python-pep-starter-policy"
    },
    method: "POST"
  });

  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function spawnPython(args: string[]): Promise<{ status: number | null; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("python3", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ACCESS_KIT_API_KEY: apiKey,
        ACCESS_KIT_BASE_URL: baseUrl,
        PYTHONPATH: [exampleDir, process.env.PYTHONPATH].filter(Boolean).join(":")
      }
    });
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        resolve({ status: 1, output: `${output}\nPython subprocess timed out.` });
      }
    }, 15000);
    const finish = (result: { status: number | null; output: string }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      }
    };
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        finish({
          status: 1,
          output: "Python 3 is required for validate:pep-conformance; install python3 and retry."
        });
        return;
      }

      fail(error);
    });
    child.on("close", (status) => {
      finish({ status, output });
    });
  });
}
