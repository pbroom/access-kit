import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const root = process.cwd();
const exampleRoot = join(root, "examples/go-envoy-ext-authz");

describe("Go Envoy ext-authz PEP example", () => {
  it("maps the shared PEP conformance cases into Go example tests", async () => {
    const source = await readExample("client_test.go");

    for (const testName of [
      "TestClientCheckAndExplainDiagnosticsUseLocalAPI",
      "TestClientSurfacesAuthenticationFailure",
      "TestExtAuthzPropagatesCorrelationIDsAndLogsAllowDecisions",
      "TestExtAuthzDeniesByDefaultAndRedactsSensitivePaths",
      "TestExtAuthzFailsClosedWhenAccessKitFails",
      "TestExtAuthzGeneratesStableRequestCorrelationID",
      "TestDefaultEnvoyDecisionRequestIgnoresSpoofedDownstreamAuthzTupleHeaders",
      "TestDefaultEnvoyDecisionRequestRequiresTrustedSubjectHeader"
    ]) {
      expect(source).toContain(`func ${testName}`);
    }

    expect(source).toContain("x-local-admin");
    expect(source).toContain("TrustedSubjectHeader");
    expect(source).toContain("x-access-kit-action");
    expect(source).toContain("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(source).toContain("ACCESS_KIT_UNAVAILABLE");
    expect(source).toContain("member_of_sensitive_compensation_group");
  });

  it("keeps protected ext-authz checks fail-closed and explain-safe", async () => {
    const source = await readExample("ext_authz.go");

    expect(source).toContain(".Check(");
    expect(source).not.toContain(".ExplainDiagnostics(");
    expect(source).toContain("ACCESS_KIT_UNAVAILABLE");
    expect(source).toContain("ACCESS_KIT_INVALID_REQUEST");
    expect(source).toContain("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(source).toContain("x-correlation-id");
    expect(source).toContain('const TrustedSubjectHeader = "x-access-kit-trusted-subject"');
    expect(source).not.toContain('firstHeader(request, "x-access-kit-action"');
    expect(source).not.toContain('firstHeader(request, "x-access-kit-subject"');
    expect(source).not.toContain('firstHeader(request, "x-access-kit-resource"');
    expect(source).not.toContain('firstHeader(request, "x-subject-id"');
    expect(source).toContain("DecisionLogEntry");

    const denialResponse = source.slice(source.indexOf("type DenialResponse"), source.indexOf("func NewExtAuthzHandler"));
    expect(denialResponse).toContain("Code");
    expect(denialResponse).toContain("CorrelationID");
    expect(denialResponse).toContain("ReasonCode");
    expect(denialResponse).not.toContain("DecisionID");
    expect(denialResponse).not.toContain("RelationshipPath");
  });

  it("implements check, safe explain diagnostics, and policy-test CI client calls", async () => {
    const client = await readExample("client.go");
    const policyCi = await readExample("cmd/policy-test-ci/main.go");

    expect(client).toContain('"/v1/decision/check"');
    expect(client).toContain('"/v1/decision/explain"');
    expect(client).toContain("type DecisionDiagnostics struct");
    expect(client).toContain("RelationshipPathLength");
    expect(client).toContain("HasRelationshipPath");
    expect(client).toContain("/v1/policies/%s/validate");
    expect(policyCi).toContain("corr:go-policy-test-ci");
    expect(policyCi).toContain("os.Exit(1)");

    const diagnosticsStruct = client.slice(client.indexOf("type DecisionDiagnostics struct"), client.indexOf("type PolicyTestResult struct"));
    expect(diagnosticsStruct).not.toContain("RelationshipPath []");
    expect(diagnosticsStruct).not.toContain("SubjectID");
    expect(diagnosticsStruct).not.toContain("ResourceID");
  });

  it("documents local API, Envoy, and CI usage without production secrets", async () => {
    const readme = await readExample("README.md");

    expect(readme).toContain("REBAC_API_KEYS=local-dev-key");
    expect(readme).toContain("go test ./...");
    expect(readme).toContain("go run ./cmd/policy-test-ci");
    expect(readme).toContain("go run ./cmd/ext-authz");
    expect(readme).toContain("failure_mode_allow: false");
    expect(readme).toContain("x-access-kit-trusted-subject");
    expect(readme).toContain("Do not let callers choose");
    expect(readme).toContain("Relationship paths, sensitive subject IDs, route paths, and decision IDs stay out");
    expect(readme).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("provides an Envoy ext_authz gateway that fails closed", async () => {
    const config = await readExample("envoy.yaml");
    const parsed = YAML.parse(config) as Record<string, unknown>;
    const serialized = JSON.stringify(parsed);

    expect(serialized).toContain("envoy.filters.http.ext_authz");
    expect(serialized).toContain("access_kit_go_ext_authz");
    expect(serialized).toContain("protected_app");
    expect(serialized).toContain("x-access-kit-trusted-subject");
    expect(serialized).toContain("x-correlation-id");
    expect(config).toContain("failure_mode_allow: false");
    expect(config).not.toContain("failure_mode_allow: true");
    expect(config).not.toContain("x-subject-id");
    expect(config).not.toContain("x-access-kit-action");
    expect(config).not.toContain("x-access-kit-subject");
    expect(config).not.toContain("x-access-kit-resource");
  });
});

async function readExample(path: string): Promise<string> {
  return readFile(join(exampleRoot, path), "utf8");
}
