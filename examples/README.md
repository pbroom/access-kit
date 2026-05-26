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
| CLI command examples | `examples/cli/operator-and-assessor.sh` |
| Connector template example | `examples/connectors/sample-readonly-template.md`, `packages/connectors-sample-readonly/` |
| Control/evidence mapping example | `examples/control-evidence-mapping.json` |

Schema fixtures are validated by `pnpm validate:schemas`. Policy proof points are validated by `pnpm validate:policy`. The sample policy repository is validated by `pnpm validate:sample-policy`, and the demo seed harness manifest is checked by core tests against `createDemoSeedHarness()`. The examples in this directory are documentation examples and should remain consistent with OpenAPI, CLI, and schema contracts.
