# Examples

These examples are synthetic and safe to use in documentation, demos, tests, and assessor walkthroughs. They do not contain live tenant IDs, emails, secrets, tokens, customer names, production logs, or provider account IDs.

## Canonical Example Sources

| Example type | Canonical path |
| --- | --- |
| Schema examples | `tests/fixtures/schema-examples/*.json` |
| Policy proof points | `tests/fixtures/policy/proof-points.json` |
| API request/response examples | `examples/api/*.json` |
| CLI command examples | `examples/cli/operator-and-assessor.sh` |
| Control/evidence mapping example | `examples/control-evidence-mapping.json` |

Schema fixtures are validated by `pnpm validate:schemas`. Policy proof points are validated by `pnpm validate:policy`. The examples in this directory are documentation examples and should remain consistent with OpenAPI, CLI, and schema contracts.
