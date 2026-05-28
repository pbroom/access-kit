import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { basename, join } from "node:path";
import { schemaManifest } from "../packages/api-contracts/src/index.js";
import { listJsonFiles, readJsonFile } from "./lib/files.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const schemaByExample = new Map<string, string>([
  ["subject.json", "schemas/subject.schema.json"],
  ["resource.json", "schemas/resource.schema.json"],
  ["relationship.json", "schemas/relationship.schema.json"],
  ["decision.json", "schemas/decision.schema.json"],
  ["native-grant.json", "schemas/native-grant.schema.json"],
  ["discovery-run.json", "schemas/discovery-run.schema.json"],
  ["connector-security-review.json", "schemas/connector-security-review.schema.json"],
  ["enforcement-readiness.json", "schemas/enforcement-readiness.schema.json"],
  ["policy-model.json", "schemas/policy-model.schema.json"],
  ["provisioning-plan.json", "schemas/provisioning-plan.schema.json"],
  ["audit-event.json", "schemas/audit-event.schema.json"],
  ["audit-export.json", "schemas/audit-export.schema.json"],
  ["drift-finding.json", "schemas/drift-finding.schema.json"],
  ["audit-integrity.json", "schemas/audit-integrity.schema.json"],
  ["persistence-deployment-manifest.json", "schemas/persistence-deployment-manifest.schema.json"],
  ["persistence-deployment-readiness.json", "schemas/persistence-deployment-readiness.schema.json"],
  ["runbook-exercise.json", "schemas/runbook-exercise.schema.json"],
  ["live-enforcement-pilot-manifest.json", "schemas/live-enforcement-pilot-manifest.schema.json"],
  ["live-enforcement-pilot-readiness.json", "schemas/live-enforcement-pilot-readiness.schema.json"],
  ["product-release-manifest.json", "schemas/product-release-manifest.schema.json"],
  ["evidence-export.json", "schemas/evidence-export.schema.json"]
]);

const root = process.cwd();

for (const schemaPath of schemaManifest) {
  const schema = await readJsonFile<AnySchema>(join(root, schemaPath));
  ajv.addSchema(schema, schemaPath);
}

const exampleFiles = await listJsonFiles(join(root, "tests/fixtures/schema-examples"));
const results: string[] = [];

for (const exampleFile of exampleFiles) {
  const exampleName = basename(exampleFile);
  const schemaPath = schemaByExample.get(exampleName);

  if (!schemaPath) {
    throw new Error(`No schema mapping exists for fixture ${exampleName}`);
  }

  const validate = ajv.getSchema(schemaPath);

  if (!validate) {
    throw new Error(`Schema was not registered: ${schemaPath}`);
  }

  const data = await readJsonFile(exampleFile);

  if (!validate(data)) {
    throw new Error(
      `Fixture ${exampleName} failed ${schemaPath}: ${ajv.errorsText(validate.errors)}`
    );
  }

  results.push(`${exampleName} -> ${schemaPath}`);
}

for (const schemaPath of schemaManifest) {
  if (!ajv.getSchema(schemaPath)) {
    throw new Error(`Schema manifest entry was not registered: ${schemaPath}`);
  }
}

console.log(`Validated ${schemaManifest.length} schemas and ${results.length} example fixtures.`);
for (const result of results) {
  console.log(`PASS ${result}`);
}
