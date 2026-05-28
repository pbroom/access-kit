# Sample SaaS Application

This sample shows a synthetic tenant-scoped SaaS route using Access Kit as the policy enforcement point. It is safe for tests and demos: it has no production tenant IDs, customer data, tokens, secrets, provider account IDs, or live authorization paths.

## Protected Case Route

The route shape is:

```txt
GET /tenants/tenant:alpha/cases/case-plan
```

The sample reads the subject from trusted application authentication state at `request.auth.subjectId` and builds an Access Kit `check` request for `document:case-plan`. Run authentication middleware before this handler and populate `request.auth` from a verified session, JWT, mTLS gateway identity, or equivalent trusted source. Do not map authorization subjects from caller-supplied headers such as `x-subject-id` or `x-user-id`; those headers are user-controlled unless trusted infrastructure strips and reissues them first.

The handler only returns the case after Access Kit returns `allow`; API failures and denials fail closed. Unknown cases and tenant mismatches return a safe denial before a protected resource is resolved.

The response includes a correlation ID and decision ID for traceability on allowed requests. End-user denial responses contain only a denial code, correlation ID, and safe reason code. They do not include relationship paths, sensitive identifiers, or debug traces.

## Safe Explain Diagnostics

`explainCaseAccess()` is a separate diagnostic path. It calls Access Kit `explain` and returns a safe summary with the decision, decision ID, reason code, resource ID, tenant ID, and relationship-path length. It intentionally omits the raw `relationshipPath`.

## Policy Test Workflow

`runPolicyWorkflow()` calls the Access Kit policy validation endpoint with a correlation ID and returns a compact report for CI checks. This mirrors the PEP workflow expectation that application teams test policies without embedding production secrets in source.

Run the focused validation:

```sh
pnpm validate:sample-saas-app
```
