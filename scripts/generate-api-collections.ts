import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createApiCollectionDefinitions,
  requestUrl,
  type ApiCollectionAuthMode,
  type ApiCollectionDefinitionSet,
  type ApiCollectionRequestDefinition
} from "./lib/api-collections.js";

const root = process.cwd();
const checkMode = process.argv.includes("--check");
const definitions = createApiCollectionDefinitions();

assertCoverage(definitions);

const generatedFiles = new Map<string, string>([
  ["examples/api-collections/README.md", renderReadme(definitions)],
  [
    "examples/api-collections/postman/access-kit-demo-seed.postman_collection.json",
    `${JSON.stringify(renderPostmanCollection(definitions), null, 2)}\n`
  ],
  ["examples/api-collections/bruno/bruno.json", `${JSON.stringify(renderBrunoJson(definitions), null, 2)}\n`],
  ["examples/api-collections/bruno/collection.bru", renderBrunoCollection(definitions)],
  ["examples/api-collections/bruno/environments/Local.bru", renderBrunoEnvironment(definitions)]
]);

for (const folder of postmanFolders(definitions)) {
  generatedFiles.set(
    `examples/api-collections/bruno/${folder.name}/folder.bru`,
    renderBrunoFolder(folder.name, folder.sequence)
  );

  for (const request of folder.requests) {
    generatedFiles.set(
      `examples/api-collections/bruno/${folder.name}/${request.slug}.bru`,
      renderBrunoRequest(request, definitions)
    );
  }
}

assertNoCheckedInSecrets(generatedFiles);

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

function renderReadme(input: ApiCollectionDefinitionSet): string {
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

function renderPostmanCollection(input: ApiCollectionDefinitionSet): Record<string, unknown> {
  return {
    info: {
      name: input.name,
      description: input.description,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: `{{${input.tokenVariable}}}`, type: "string" }]
    },
    variable: [
      { key: input.baseUrlVariable, value: input.defaultBaseUrl },
      { key: input.tokenVariable, value: "", type: "secret" },
      { key: input.invalidTokenVariable, value: input.invalidTokenValue, type: "secret" },
      { key: "demo_policy_id", value: "" },
      { key: "provisioning_plan_id", value: "" }
    ],
    item: postmanFolders(input).map((folder) => ({
      name: folder.name,
      item: folder.requests.map((request) => renderPostmanRequest(request, input))
    }))
  };
}

function renderPostmanRequest(
  request: ApiCollectionRequestDefinition,
  input: ApiCollectionDefinitionSet
): Record<string, unknown> {
  const headers: Array<Record<string, string>> = [];
  if (request.body !== undefined) {
    headers.push({ key: "Content-Type", value: "application/json" });
  }
  if (request.idempotencyKey) {
    headers.push({ key: "Idempotency-Key", value: request.idempotencyKey });
  }

  const postmanRequest: Record<string, unknown> = {
    name: request.name,
    description: request.description,
    event: [{ listen: "test", script: { type: "text/javascript", exec: postmanTestScript(request) } }],
    request: {
      method: request.method,
      header: headers,
      url: `{{${input.baseUrlVariable}}}${requestUrl(request)}`,
      ...(postmanAuth(request.auth, input)),
      ...(request.body === undefined
        ? {}
        : {
            body: {
              mode: "raw",
              raw: JSON.stringify(request.body, null, 2),
              options: { raw: { language: "json" } }
            }
          })
    }
  };

  return postmanRequest;
}

function postmanAuth(auth: ApiCollectionAuthMode, input: ApiCollectionDefinitionSet): Record<string, unknown> {
  if (auth === "inherit") {
    return {};
  }

  if (auth === "none") {
    return { auth: { type: "noauth" } };
  }

  return {
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: `{{${input.invalidTokenVariable}}}`, type: "string" }]
    }
  };
}

function postmanTestScript(request: ApiCollectionRequestDefinition): string[] {
  const lines = [
    `pm.test("status is ${request.expectedStatus}", function () {`,
    `  pm.response.to.have.status(${request.expectedStatus});`,
    "});"
  ];

  if (request.expectedCode) {
    lines.push(
      "",
      "pm.test(\"error code is expected\", function () {",
      "  const body = pm.response.json();",
      `  pm.expect(body.code).to.eql(${JSON.stringify(request.expectedCode)});`,
      "});"
    );
  }

  for (const capture of request.capture ?? []) {
    lines.push(
      "",
      "if (pm.response.code >= 200 && pm.response.code < 300) {",
      "  const body = pm.response.json();",
      `  pm.collectionVariables.set(${JSON.stringify(capture.variable)}, body${capture.responsePath.map((segment) => `[${JSON.stringify(segment)}]`).join("")});`,
      "}"
    );
  }

  return lines;
}

function renderBrunoJson(input: ApiCollectionDefinitionSet): Record<string, unknown> {
  return {
    version: "1",
    name: input.name,
    type: "collection",
    ignore: ["node_modules", ".git"]
  };
}

function renderBrunoCollection(input: ApiCollectionDefinitionSet): string {
  return `headers {
  Accept: application/json
}

auth {
  mode: bearer
}

auth:bearer {
  token: {{${input.tokenVariable}}}
}

vars {
  ${input.baseUrlVariable}: ${input.defaultBaseUrl}
  ${input.tokenVariable}:
  ${input.invalidTokenVariable}: ${input.invalidTokenValue}
  demo_policy_id:
  provisioning_plan_id:
}

vars:secret [
  ${input.tokenVariable}
  ${input.invalidTokenVariable}
]

docs {
  ${input.description}
}
`;
}

function renderBrunoEnvironment(input: ApiCollectionDefinitionSet): string {
  return `vars {
  ${input.baseUrlVariable}: ${input.defaultBaseUrl}
  ${input.tokenVariable}:
  ${input.invalidTokenVariable}: ${input.invalidTokenValue}
}

vars:secret [
  ${input.tokenVariable}
  ${input.invalidTokenVariable}
]
`;
}

function renderBrunoFolder(name: string, sequence: number): string {
  return `meta {
  name: ${name}
  type: folder
  seq: ${sequence}
}
`;
}

function renderBrunoRequest(request: ApiCollectionRequestDefinition, input: ApiCollectionDefinitionSet): string {
  const method = request.method.toLowerCase();
  const methodLines = [
    `${method} {`,
    `  url: {{${input.baseUrlVariable}}}${requestUrl(request)}`,
    `  body: ${request.body === undefined ? "none" : "json"}`,
    ...brunoAuthLine(request.auth),
    "}"
  ];
  const sections = [
    `meta {
  name: ${request.name}
  type: http
  seq: ${request.sequence}
}`,
    methodLines.join("\n")
  ];

  const headers = brunoHeaders(request);
  if (headers.length > 0) {
    sections.push(`headers {\n${headers.map(([key, value]) => `  ${key}: ${value}`).join("\n")}\n}`);
  }

  if (request.auth === "invalid") {
    sections.push(`auth {
  mode: bearer
}

auth:bearer {
  token: {{${input.invalidTokenVariable}}}
}`);
  }

  if (request.body !== undefined) {
    sections.push(`body:json {\n${indent(JSON.stringify(request.body, null, 2), 2)}\n}`);
  }

  const scripts = brunoPostResponseScript(request);
  if (scripts.length > 0) {
    sections.push(`script:post-response {\n${indent(scripts.join("\n"), 2)}\n}`);
  }

  sections.push(`tests {
  test("status is ${request.expectedStatus}", function() {
    expect(res.status).to.eql(${request.expectedStatus});
  });
${request.expectedCode ? `\n  test("error code is expected", function() {\n    expect(res.body.code).to.eql(${JSON.stringify(request.expectedCode)});\n  });\n` : ""}
}`);

  sections.push(`docs {\n${indent(request.description, 2)}\n}`);

  return `${sections.join("\n\n")}\n`;
}

function brunoAuthLine(auth: ApiCollectionAuthMode): string[] {
  if (auth === "inherit") {
    return [];
  }

  if (auth === "none") {
    return ["  auth: none"];
  }

  return ["  auth: bearer"];
}

function brunoHeaders(request: ApiCollectionRequestDefinition): Array<[string, string]> {
  const headers: Array<[string, string]> = [];

  if (request.body !== undefined) {
    headers.push(["Content-Type", "application/json"]);
  }

  if (request.idempotencyKey) {
    headers.push(["Idempotency-Key", request.idempotencyKey]);
  }

  return headers;
}

function brunoPostResponseScript(request: ApiCollectionRequestDefinition): string[] {
  return (request.capture ?? []).map((capture) => {
    const accessor = capture.responsePath.map((segment) => `[${JSON.stringify(segment)}]`).join("");
    return `bru.setVar(${JSON.stringify(capture.variable)}, res.body${accessor});`;
  });
}

function postmanFolders(input: ApiCollectionDefinitionSet): Array<{
  name: string;
  sequence: number;
  requests: ApiCollectionRequestDefinition[];
}> {
  const folders = new Map<string, { name: string; sequence: number; requests: ApiCollectionRequestDefinition[] }>();

  for (const request of input.requests) {
    const folder = folders.get(request.folder) ?? {
      name: request.folder,
      sequence: folders.size + 1,
      requests: []
    };
    folder.requests.push(request);
    folders.set(request.folder, folder);
  }

  return [...folders.values()];
}

function assertCoverage(input: ApiCollectionDefinitionSet): void {
  const covered = new Set(input.requests.flatMap((request) => request.coverage));
  const missing = input.requiredCoverage.filter((item) => !covered.has(item));

  if (missing.length > 0) {
    throw new Error(`API collection definitions are missing coverage: ${missing.join(", ")}`);
  }
}

function assertNoCheckedInSecrets(files: Map<string, string>): void {
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
  if (variables.get("invalid_rebac_api_token") !== definitions.invalidTokenValue) {
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

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}
