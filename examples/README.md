# Examples

These examples are synthetic and safe to use in documentation, demos, tests, and assessor walkthroughs. They do not contain live tenant IDs, emails, secrets, tokens, customer names, production logs, or provider account IDs.

## Canonical Example Sources

| Example type | Canonical path |
| --- | --- |
| Schema examples | `tests/fixtures/schema-examples/*.json` |
| Policy proof points | `tests/fixtures/policy/proof-points.json` |
| Sample policy repository | `examples/sample-policy-repository/` |
| Demo seed harness manifest | `examples/demo-seed-harness.json` |
| Five-minute quickstart runner | `scripts/quickstart-demo.ts` |
| Developer evaluation runner | `scripts/evaluation-demo.ts` |
| API request/response examples | `examples/api/*.json` |
| API collections | `examples/api-collections/` |
| TypeScript Express PEP starter | `examples/typescript-express-pep/` |
| Sample SaaS application | `examples/sample-saas-app/` |
| Python FastAPI PEP starter | `examples/python-fastapi-pep/` |
| Go Envoy ext-authz PEP example | `examples/go-envoy-ext-authz/` |
| CLI command examples | `examples/cli/operator-and-assessor.sh` |
| Connector template example | `examples/connectors/sample-readonly-template.md`, `packages/connectors-sample-readonly/` |
| CLI profile example | `examples/cli/profiles.example.json` |
| Control/evidence mapping example | `examples/control-evidence-mapping.json` |
| Product release manifest example | `tests/fixtures/schema-examples/product-release-manifest.json` |

Schema fixtures are validated by `pnpm validate:schemas`. Policy proof points are validated by `pnpm validate:policy`. The sample policy repository is validated by `pnpm validate:sample-policy`, and the demo seed harness manifest is checked by core tests against `createDemoSeedHarness()`. API collection artifacts are generated and checked by `pnpm validate:api-collections`. The TypeScript Express, Python FastAPI, and Go Envoy PEP examples are covered by `pnpm validate:pep-conformance`, and the TypeScript client is covered by `tests/sdk-pep/typescript-client.test.ts`. The sample SaaS application is validated by `pnpm validate:sample-saas-app`. The examples in this directory are documentation examples and should remain consistent with OpenAPI, CLI, SDK, gateway, sample app, and schema contracts.
