import { describe, expect, it } from "vitest";
import {
  GENERATED_POLICY_REVIEW_NOTICE,
  generatePolicyTestArtifacts
} from "../../scripts/lib/generated-policy-tests.js";

describe("generated policy test artifacts", () => {
  it("builds starter authorization tests, tuple fixtures, requests, and expected results from each sample model", async () => {
    const generated = await generatePolicyTestArtifacts({ root: process.cwd() });
    const v2Suite = generated.suites.find((suite) => suite.source.modelVersion === "policy:case-docs-v2");

    expect(generated.suites).toHaveLength(2);
    expect(v2Suite).toBeDefined();
    expect(v2Suite?.reviewNotice).toBe(GENERATED_POLICY_REVIEW_NOTICE);
    expect(v2Suite?.tupleFixture.reviewOnly).toBe(true);
    expect(v2Suite?.tupleFixture.subjects.map((subject) => subject.sourceSystem)).toEqual(
      expect.arrayContaining(["generated-policy-tests"])
    );
    expect(v2Suite?.authorizationTests.every((test) => test.reviewOnly)).toBe(true);
    expect(v2Suite?.authorizationTests.map((test) => test.category)).toEqual(
      expect.arrayContaining([
        "allow-path",
        "deny-default",
        "tenant-boundary",
        "explicit-deny",
        "classification-boundary"
      ])
    );
    expect(v2Suite?.authorizationTests.map((test) => test.expected.reasonCode)).toEqual(
      expect.arrayContaining([
        "ALLOW_VIA_RELATIONSHIP_PATH",
        "DENY_DEFAULT_NO_RELATIONSHIP_PATH",
        "DENY_TENANT_BOUNDARY",
        "DENY_EXPLICIT_OVERRIDE"
      ])
    );

    expect(generated.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "generated/policy-tests/manifest.json",
        "generated/policy-tests/case-docs-v2/tuple-fixture.json",
        "generated/policy-tests/case-docs-v2/authorization-tests.json",
        "generated/policy-tests/case-docs-v2/example-requests/generated-reviewer-read-allowed.request.json",
        "generated/policy-tests/case-docs-v2/expected-results/generated-reviewer-read-allowed.expected.json"
      ])
    );
  });

  it("labels migration regression snapshots as review aids that do not replace authored coverage", async () => {
    const generated = await generatePolicyTestArtifacts({ root: process.cwd() });
    const [migrationSnapshot] = generated.migrationSnapshots;

    expect(migrationSnapshot).toBeDefined();
    expect(migrationSnapshot?.reviewOnly).toBe(true);
    expect(migrationSnapshot?.reviewNotice).toBe(GENERATED_POLICY_REVIEW_NOTICE);
    expect(migrationSnapshot?.migration).toMatchObject({
      fromVersion: "policy:case-docs-v1",
      toVersion: "policy:case-docs-v2"
    });
    expect(migrationSnapshot?.targetModel.contextConstraints).toEqual(
      expect.arrayContaining(["businessJustification", "supportEscalationApproved"])
    );
    expect(migrationSnapshot?.reviewerChecklist.join(" ")).toContain("hand-authored deny-default");
    expect(migrationSnapshot?.starterRegressionCases.map((test) => test.category)).toEqual(
      expect.arrayContaining(["deny-default", "tenant-boundary", "explicit-deny"])
    );
  });
});
