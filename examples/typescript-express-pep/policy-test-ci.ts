import { createAccessKitClient } from "../../packages/typescript-client/src/index.js";

const apiKey = process.env.ACCESS_KIT_API_KEY;
const baseUrl = process.env.ACCESS_KIT_BASE_URL ?? "http://127.0.0.1:3000";
const policyId = process.argv[2];

if (!apiKey) {
  throw new Error("ACCESS_KIT_API_KEY is required.");
}

if (!policyId) {
  throw new Error("Usage: pnpm tsx examples/typescript-express-pep/policy-test-ci.ts <policy-id>");
}

const client = createAccessKitClient({ apiKey, baseUrl });
const result = await client.testPolicy(policyId, { correlationId: "corr:policy-test-ci" });
const failingChecks = result.checks.filter((check) => check.status === "fail");

if (!result.valid || failingChecks.length > 0) {
  throw new Error(`Policy ${policyId} failed ${failingChecks.length} policy-test checks.`);
}

console.log(`PASS ${policyId} policy-test checks.`);
