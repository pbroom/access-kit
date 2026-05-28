import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createApiCollectionModel,
  renderBrunoCollection,
  renderBrunoEnvironment,
  renderBrunoFolder,
  renderBrunoJson,
  renderBrunoRequest,
  renderPostmanCollection,
  type ApiCollectionModel
} from "./lib/api-collection-renderer.js";
import { createApiCollectionDefinitions } from "./lib/api-collections.js";

const root = process.cwd();
const checkMode = process.argv.includes("--check");
const definitions = createApiCollectionDefinitions();
const collection = createApiCollectionModel(definitions);

const generatedFiles = new Map<string, string>([
  ["examples/api-collections/README.md", renderReadme(collection)],
  [
    "examples/api-collections/postman/access-kit-demo-seed.postman_collection.json",
    `${JSON.stringify(renderPostmanCollection(collection), null, 2)}\n`
  ],
  ["examples/api-collections/bruno/bruno.json", `${JSON.stringify(renderBrunoJson(collection), null, 2)}\n`],
  ["examples/api-collections/bruno/collection.bru", renderBrunoCollection(collection)],
  ["examples/api-collections/bruno/environments/Local.bru", renderBrunoEnvironment(collection)]
]);

for (const folder of collection.folders) {
  generatedFiles.set(
    `examples/api-collections/bruno/${folder.name}/folder.bru`,
    renderBrunoFolder(folder)
  );

  for (const request of folder.requests) {
    generatedFiles.set(
      `examples/api-collections/bruno/${folder.name}/${request.slug}.bru`,
      renderBrunoRequest(request, collection)
    );
  }
}

assertNoCheckedInSecrets(generatedFiles, collection);

if (checkMode) {
  const drift = await collectDrift(generatedFiles);
  if (drift.length > 0) {
    console.error("API collection artifacts are out of date. Run `pnpm generate:api-collections`.");
    for (const entry of drift) {
      console.error(`- ${entry}`);
    }
    process.exitCode = 1;
  } else {
    console.log("API collection artifacts are current.");
  }
} else {
  await rm(join(root, "examples/api-collections/postman"), { recursive: true, force: true });
  await rm(join(root, "examples/api-collections/bruno"), { recursive: true, force: true });
  for (const [path, contents] of generatedFiles) {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }
  console.log(`Wrote ${generatedFiles.size} API collection artifact(s).`);
}

function renderReadme(input: ApiCollectionModel): string {
  const coverage = input.requiredCoverage.map((item) => `- ${item.replace(/_/g, " ")}`).join("\n");

  return `# API Collections

This directory contains generated Postman and Bruno collections for the Access Kit demo seed evaluation flow. The requests use the synthetic IDs from \`examples/demo-seed-harness.json\` and do not include live tenant data, production identifiers, or checked-in secrets.

## Run The Demo Seed API

Start a local API that is explicitly seeded with the demo harness:

\`\`\`sh
export REBAC_API_KEYS="<local throwaway bearer token>"
corepack pnpm api-collections:demo
\`\`\`

Set the same local token in your Postman or Bruno environment variable named \`${input.tokenVariable}\`. Leave \`${input.invalidTokenVariable}\` as \`${input.invalidTokenValue}\`; it is intentionally invalid for the auth-failure examples.

## Collections

- Postman: \`postman/access-kit-demo-seed.postman_collection.json\`
- Bruno: \`bruno/\`

Run the setup request first so \`demo_policy_id\` is captured before the policy-test request. Run the dry-run provisioning plan request before the job request so \`provisioning_plan_id\` is captured. The authentication-failure requests intentionally disable or override collection auth and should return \`401\` when the API is started with \`REBAC_API_KEYS\`.

## Coverage

${coverage}

Regenerate these artifacts with:

\`\`\`sh
corepack pnpm generate:api-collections
\`\`\`

Validation runs through:

\`\`\`sh
corepack pnpm validate:api-collections
\`\`\`
`;
}

function assertNoCheckedInSecrets(files: Map<string, string>, input: ApiCollectionModel): void {
  const forbiddenPatterns = [
    /sk-[A-Za-z0-9_-]{20,}/,
    /ghp_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /Bearer\s+(?!\{\{)[A-Za-z0-9._-]{12,}/
  ];

  for (const [path, contents] of files) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(contents)) {
        throw new Error(`${path} appears to contain checked-in secret material matching ${pattern}.`);
      }
    }
  }

  const postman = JSON.parse(
    files.get("examples/api-collections/postman/access-kit-demo-seed.postman_collection.json") ?? "{}"
  ) as { variable?: Array<{ key?: string; value?: string }> };
  const variables = new Map((postman.variable ?? []).map((variable) => [variable.key, variable.value]));

  if (variables.get("rebac_api_token") !== "") {
    throw new Error("Postman rebac_api_token must be empty in source control.");
  }
  if (variables.get("invalid_rebac_api_token") !== input.invalidTokenValue) {
    throw new Error("Postman invalid_rebac_api_token must use the intentionally invalid sentinel.");
  }
}

async function collectDrift(files: Map<string, string>): Promise<string[]> {
  const drift: string[] = [];

  for (const [path, expected] of files) {
    const actual = await readFile(join(root, path), "utf8").catch(() => undefined);

    if (actual === undefined) {
      drift.push(`${path} is missing`);
    } else if (actual !== expected) {
      drift.push(`${path} differs from generated output`);
    }
  }

  return drift;
}
