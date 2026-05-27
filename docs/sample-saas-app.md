# Sample SaaS Application

The sample SaaS application is the end-to-end application example for the SDK and PEP foundation. It demonstrates a protected tenant-scoped route, safe diagnostic explain output, decision and correlation traceability, and policy-test workflow integration.

## Contract

| Capability | Sample behavior |
| --- | --- |
| Protected route | `handleCaseRead()` protects `GET /tenants/tenant:alpha/cases/case-plan` with the TypeScript Express-style PEP middleware. |
| Tenant boundary | Route resolution maps only synthetic `tenant:alpha` to `document:case-plan`; unknown cases and tenant mismatches fail closed with safe denials. |
| Check call | Known protected routes call Access Kit `check` before the handler returns case content. |
| Explain call | `explainCaseAccess()` is an operator diagnostic path and returns only a safe summary, not raw relationship paths. |
| Correlation ID | Caller-supplied `x-correlation-id` values are forwarded to Access Kit and echoed on responses. |
| Decision ID | Allowed route responses and internal decision events retain the Access Kit decision ID for traceability. |
| Safe errors | Denial responses contain `ACCESS_DENIED`, a correlation ID, and a safe reason code only. |
| Policy workflow | `runPolicyWorkflow()` calls policy validation and returns the failing check names for CI integration. |

## Validation

Run the focused sample app test gate:

```sh
pnpm validate:sample-saas-app
```

The test suite starts the local API with synthetic demo seed data and verifies allow, deny, unavailable-API, safe explain, and policy-test behavior. It also proves the protected route does not call `explain` automatically and does not fall back to local authorization when Access Kit denies or is unavailable.

## Boundaries

The sample is not a production application, tenant isolation claim, identity provider, or substitute for native application authorization hardening. It intentionally avoids production tenant IDs, emails, tokens, customer names, provider account IDs, and raw authorization paths.
