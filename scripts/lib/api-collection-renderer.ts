import {
  requestUrl,
  type ApiCollectionAuthMode,
  type ApiCollectionCapture,
  type ApiCollectionCoverage,
  type ApiCollectionDefinitionSet,
  type ApiCollectionMethod,
  type ApiCollectionRequestDefinition,
  type JsonValue
} from "./api-collections.js";

export interface ApiCollectionVariable {
  readonly key: string;
  readonly value: string;
  readonly secret?: boolean;
}

export interface ApiCollectionHeader {
  readonly key: string;
  readonly value: string;
}

export interface ApiCollectionRequestModel {
  readonly name: string;
  readonly slug: string;
  readonly folder: string;
  readonly sequence: number;
  readonly method: ApiCollectionMethod;
  readonly url: string;
  readonly auth: ApiCollectionAuthMode;
  readonly headers: readonly ApiCollectionHeader[];
  readonly body?: JsonValue;
  readonly bodyMode: "none" | "json";
  readonly idempotencyKey?: string;
  readonly expectedStatus: number;
  readonly expectedCode?: string;
  readonly coverage: readonly ApiCollectionCoverage[];
  readonly capture: readonly ApiCollectionCapture[];
  readonly description: string;
}

export interface ApiCollectionFolderModel {
  readonly name: string;
  readonly sequence: number;
  readonly requests: readonly ApiCollectionRequestModel[];
}

export interface ApiCollectionModel {
  readonly name: string;
  readonly description: string;
  readonly baseUrlVariable: string;
  readonly tokenVariable: string;
  readonly invalidTokenVariable: string;
  readonly defaultBaseUrl: string;
  readonly invalidTokenValue: string;
  readonly requiredCoverage: readonly ApiCollectionCoverage[];
  readonly collectionVariables: readonly ApiCollectionVariable[];
  readonly environmentVariables: readonly ApiCollectionVariable[];
  readonly requests: readonly ApiCollectionRequestModel[];
  readonly folders: readonly ApiCollectionFolderModel[];
}

export function createApiCollectionModel(definitions: ApiCollectionDefinitionSet): ApiCollectionModel {
  assertCoverage(definitions);

  const collectionVariables: ApiCollectionVariable[] = [
    { key: definitions.baseUrlVariable, value: definitions.defaultBaseUrl },
    { key: definitions.tokenVariable, value: "", secret: true },
    { key: definitions.invalidTokenVariable, value: definitions.invalidTokenValue, secret: true },
    { key: "demo_policy_id", value: "" },
    { key: "provisioning_plan_id", value: "" }
  ];
  const environmentVariableKeys = new Set([
    definitions.baseUrlVariable,
    definitions.tokenVariable,
    definitions.invalidTokenVariable
  ]);
  const requests = definitions.requests.map((request) => normalizeRequest(request));

  return {
    name: definitions.name,
    description: definitions.description,
    baseUrlVariable: definitions.baseUrlVariable,
    tokenVariable: definitions.tokenVariable,
    invalidTokenVariable: definitions.invalidTokenVariable,
    defaultBaseUrl: definitions.defaultBaseUrl,
    invalidTokenValue: definitions.invalidTokenValue,
    requiredCoverage: definitions.requiredCoverage,
    collectionVariables,
    environmentVariables: collectionVariables.filter((variable) => environmentVariableKeys.has(variable.key)),
    requests,
    folders: groupFolders(requests)
  };
}

export function renderPostmanCollection(input: ApiCollectionModel): Record<string, unknown> {
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
    variable: input.collectionVariables.map((variable) => ({
      key: variable.key,
      value: variable.value,
      ...(variable.secret ? { type: "secret" } : {})
    })),
    item: input.folders.map((folder) => ({
      name: folder.name,
      item: folder.requests.map((request) => renderPostmanRequest(request, input))
    }))
  };
}

export function renderBrunoJson(input: ApiCollectionModel): Record<string, unknown> {
  return {
    version: "1",
    name: input.name,
    type: "collection",
    ignore: ["node_modules", ".git"]
  };
}

export function renderBrunoCollection(input: ApiCollectionModel): string {
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
${renderBrunoVariableLines(input.collectionVariables)}
}

vars:secret [
${renderBrunoSecretLines(input.collectionVariables)}
]

docs {
  ${input.description}
}
`;
}

export function renderBrunoEnvironment(input: ApiCollectionModel): string {
  return `vars {
${renderBrunoVariableLines(input.environmentVariables)}
}

vars:secret [
${renderBrunoSecretLines(input.environmentVariables)}
]
`;
}

export function renderBrunoFolder(folder: ApiCollectionFolderModel): string {
  return `meta {
  name: ${folder.name}
  type: folder
  seq: ${folder.sequence}
}
`;
}

export function renderBrunoRequest(request: ApiCollectionRequestModel, input: ApiCollectionModel): string {
  const method = request.method.toLowerCase();
  const methodLines = [
    `${method} {`,
    `  url: {{${input.baseUrlVariable}}}${request.url}`,
    `  body: ${request.bodyMode}`,
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

  if (request.headers.length > 0) {
    sections.push(`headers {\n${request.headers.map((header) => `  ${header.key}: ${header.value}`).join("\n")}\n}`);
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

function normalizeRequest(request: ApiCollectionRequestDefinition): ApiCollectionRequestModel {
  const headers: ApiCollectionHeader[] = [];

  if (request.body !== undefined) {
    headers.push({ key: "Content-Type", value: "application/json" });
  }

  if (request.idempotencyKey) {
    headers.push({ key: "Idempotency-Key", value: request.idempotencyKey });
  }

  return {
    name: request.name,
    slug: request.slug,
    folder: request.folder,
    sequence: request.sequence,
    method: request.method,
    url: requestUrl(request),
    auth: request.auth,
    headers,
    body: request.body,
    bodyMode: request.body === undefined ? "none" : "json",
    idempotencyKey: request.idempotencyKey,
    expectedStatus: request.expectedStatus,
    expectedCode: request.expectedCode,
    coverage: request.coverage,
    capture: request.capture ?? [],
    description: request.description
  };
}

function groupFolders(requests: readonly ApiCollectionRequestModel[]): ApiCollectionFolderModel[] {
  const folders = new Map<string, { name: string; sequence: number; requests: ApiCollectionRequestModel[] }>();

  for (const request of requests) {
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

function renderPostmanRequest(
  request: ApiCollectionRequestModel,
  input: ApiCollectionModel
): Record<string, unknown> {
  return {
    name: request.name,
    description: request.description,
    event: [{ listen: "test", script: { type: "text/javascript", exec: postmanTestScript(request) } }],
    request: {
      method: request.method,
      header: request.headers,
      url: `{{${input.baseUrlVariable}}}${request.url}`,
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
}

function postmanAuth(auth: ApiCollectionAuthMode, input: ApiCollectionModel): Record<string, unknown> {
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

function postmanTestScript(request: ApiCollectionRequestModel): string[] {
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

  for (const capture of request.capture) {
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

function brunoAuthLine(auth: ApiCollectionAuthMode): string[] {
  if (auth === "inherit") {
    return [];
  }

  if (auth === "none") {
    return ["  auth: none"];
  }

  return ["  auth: bearer"];
}

function brunoPostResponseScript(request: ApiCollectionRequestModel): string[] {
  return request.capture.map((capture) => {
    const accessor = capture.responsePath.map((segment) => `[${JSON.stringify(segment)}]`).join("");
    return `bru.setVar(${JSON.stringify(capture.variable)}, res.body${accessor});`;
  });
}

function renderBrunoVariableLines(variables: readonly ApiCollectionVariable[]): string {
  return variables
    .map((variable) => `  ${variable.key}:${variable.value.length > 0 ? ` ${variable.value}` : ""}`)
    .join("\n");
}

function renderBrunoSecretLines(variables: readonly ApiCollectionVariable[]): string {
  return variables.filter((variable) => variable.secret).map((variable) => `  ${variable.key}`).join("\n");
}

function assertCoverage(input: ApiCollectionDefinitionSet): void {
  const covered = new Set(input.requests.flatMap((request) => request.coverage));
  const missing = input.requiredCoverage.filter((item) => !covered.has(item));

  if (missing.length > 0) {
    throw new Error(`API collection definitions are missing coverage: ${missing.join(", ")}`);
  }
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}
