import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  compareGeneratedPolicyTestArtifacts,
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
        "DENY_EXPLICIT_OVERRIDE",
        "DENY_CLASSIFICATION_BOUNDARY"
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

  it("binds generated classification-boundary cases to the expected policy control", async () => {
    const generated = await generatePolicyTestArtifacts({ root: process.cwd() });
    const v2Suite = generated.suites.find((suite) => suite.source.modelVersion === "policy:case-docs-v2");
    const classificationBoundaryTest = v2Suite?.authorizationTests.find(
      (test) => test.category === "classification-boundary"
    );

    expect(classificationBoundaryTest).toBeDefined();
    expect(classificationBoundaryTest?.generatedFrom).toMatchObject({
      action: "write",
      classification: "restricted",
      expectedControl: {
        kind: "classification.allowedActions",
        classification: "restricted",
        deniedAction: "write",
        allowedActions: ["read", "view"],
        wrongControlNegatives: ["relationship.noGrant", "tenantBoundary", "explicitDeny"]
      }
    });
    expect(classificationBoundaryTest?.expected).toMatchObject({
      decision: "deny",
      reasonCode: "DENY_CLASSIFICATION_BOUNDARY",
      expectedControl: {
        kind: "classification.allowedActions",
        classification: "restricted",
        deniedAction: "write",
        allowedActions: ["read", "view"]
      }
    });
    expect(classificationBoundaryTest?.expected.reasonCode).not.toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(classificationBoundaryTest?.expected.relationshipPath.map((step) => step.relation)).toEqual(
      expect.arrayContaining(["contributor_to", "contains"])
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

  it("grants the denied resource in non-container explicit-deny fixtures", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "access-kit-flat-policy-"));
    const sampleRoot = join(tempRoot, "sample-policy-repository");

    try {
      await mkdir(join(sampleRoot, "models"), { recursive: true });
      await writeFile(
        join(sampleRoot, "policy-repository.json"),
        `${JSON.stringify(
          {
            repositoryId: "sample-policy-repository:flat-docs",
            currentPolicyVersion: "policy:flat-docs-v1",
            models: [{ version: "policy:flat-docs-v1", path: "models/flat-docs.v1.json" }],
            migrations: []
          },
          null,
          2
        )}\n`
      );
      await writeFile(
        join(sampleRoot, "models", "flat-docs.v1.json"),
        `${JSON.stringify(
          {
            schemaVersion: "access-kit.policy-model.v1",
            id: "policy-model:flat-docs",
            version: "policy:flat-docs-v1",
            resourceTypes: [{ type: "document", classifications: ["internal"] }],
            relations: [
              { name: "reader_of", kind: "grant", subjectTypes: ["user"], objectTypes: ["document"] },
              { name: "denied_read", kind: "deny", subjectTypes: ["user"], objectTypes: ["document"] }
            ],
            actions: [{ name: "read", grants: ["reader_of"] }],
            inheritanceRules: [],
            denyRules: [{ name: "read-deny", relation: "denied_read", actions: ["read"], precedence: "override" }],
            contextConstraints: [],
            classificationConstraints: [{ classification: "internal", allowedActions: ["read"] }],
            tenantBoundary: { key: "tenantId", source: "resource", crossTenantTraversal: false },
            migrations: []
          },
          null,
          2
        )}\n`
      );

      const generated = await generatePolicyTestArtifacts({ root: process.cwd(), sampleRoot });
      const [suite] = generated.suites;

      expect(suite?.tupleFixture.relationships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "relationship:generated-read-grant-on-denied",
            relation: "reader_of",
            objectId: "document:generated-denied-report"
          })
        ])
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("removes orphaned generated policy-test files in write mode", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "access-kit-policy-tests-"));
    const sampleRoot = join(tempRoot, "sample-policy-repository");
    const orphanPath = join(sampleRoot, "generated", "policy-tests", "orphaned", "stale.json");

    try {
      await cp(join(process.cwd(), "examples", "sample-policy-repository"), sampleRoot, { recursive: true });
      await mkdir(dirname(orphanPath), { recursive: true });
      await writeFile(orphanPath, "{}\n");

      const drift = await compareGeneratedPolicyTestArtifacts({ root: process.cwd(), sampleRoot, write: true });
      let orphanExists = true;
      try {
        await readFile(orphanPath, "utf8");
      } catch {
        orphanExists = false;
      }

      expect(drift).toContain("generated/policy-tests/orphaned/stale.json");
      expect(orphanExists).toBe(false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
