import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createDefaultPolicyPlaygroundInput,
  runPolicyPlayground,
  type PolicyPlaygroundInput
} from "../packages/core/src/index.js";

async function main(): Promise<void> {
  const filePath = process.argv[2];
  const input = filePath ? await readPlaygroundInput(filePath) : createDefaultPolicyPlaygroundInput();
  const result = runPolicyPlayground(input);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.modelValidation.valid || result.requests.some((request) => request.matchedExpected === false)) {
    process.exitCode = 1;
  }
}

async function readPlaygroundInput(filePath: string): Promise<PolicyPlaygroundInput> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as PolicyPlaygroundInput;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Policy playground input must be a JSON object.");
  }

  return parsed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`policy playground failed: ${message}\n`);
    process.exitCode = 1;
  });
}
