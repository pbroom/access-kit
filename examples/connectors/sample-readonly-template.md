# Sample Read-Only Connector Template

This example is a copyable starting point for connector authors after reading the [Connector Authoring Tutorial](../../docs/connector-authoring-tutorial.md). It demonstrates read-only discovery, redacted provider identifiers, pagination and throttling warnings, tombstone handling, native-grant readback, dry-run provisioning plans, and fail-closed write hooks.

## Canonical Package

The template lives in `packages/connectors-sample-readonly`:

- `packages/connectors-sample-readonly/src/index.ts`
- `tests/connectors/sample-readonly.test.ts`

The package is intentionally not registered by the API runtime by default. Tests register it explicitly so new connector authors can copy the shape without accidentally expanding runtime connector scope.

## Safety Defaults

- The connector starts in `read_only` mode.
- `supportsProvisioning` is `false`.
- Required scopes are synthetic and read-only: `synthetic:sample.read`.
- Forbidden write scopes are documented separately: `synthetic:sample.write`.
- `getSecurityReview()` keeps `liveWritesAllowed: false` and `controlledSyntheticOnly: false`.
- `applyProvisioningChange()` returns a failed plan instead of calling a provider write API.
- Raw provider IDs, emails, request IDs, tokens, and raw cursors are never emitted in canonical records, warnings, or evidence.
- Missing or fallback tenant boundaries fail closed before connector construction.

## Copying The Template

When adapting this sample for a provider:

1. Rename the package, connector ID, provider, and tenant boundary.
2. Replace synthetic fixture readers with provider read calls.
3. Keep provider writes disabled until a separate connector security review approves enforcement.
4. Preserve pagination allowlists, retry limits, tombstone behavior, coverage warnings, and redaction before any data reaches canonical records.
5. Update `getSecurityReview()` so consent, scopes, evidence paths, secret handling, and enforcement readiness match the provider.
6. Add provider-specific tests that prove readback, warning, redaction, stale-grant replacement, and no-write behavior.

## Validation

Run these focused checks after copying the template:

```sh
pnpm exec vitest run tests/connectors/sample-readonly.test.ts
pnpm validate:connector-security
pnpm validate:contracts
pnpm validate:docs
git diff --check
```

Run `pnpm ci:check` before submitting a connector implementation PR.
