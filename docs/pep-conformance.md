# PEP Conformance

Policy enforcement points must treat Access Kit as the deterministic authorization source for protected resources. A compliant PEP calls the Access Kit decision API for every protected request, fails closed when the API fails, and never replaces a failed or denied Access Kit response with local route logic.

## Required Behavior

| Requirement | Conformance expectation |
| --- | --- |
| API failure | Protected handlers do not run when Access Kit is unavailable, rejects authentication, times out, or returns a non-2xx response. The PEP returns a denial response with a correlation ID. |
| Correlation IDs | Caller-supplied correlation IDs are forwarded to Access Kit and echoed on the protected response. Generated correlation IDs must be stable for the request. |
| Decision logging | Allow and deny outcomes emit internal decision logs with the Access Kit decision ID, reason code, and correlation ID. |
| Local fallback avoidance | Route-local roles, cached application state, or framework-specific guards cannot authorize when Access Kit denies or fails. |
| Reason codes | Denial responses preserve machine-readable Access Kit reason codes. API failures use a distinct unavailable reason code. |
| Explain and debug safety | Protected request middleware must not call explain automatically or expose debug traces to end users. Explain output belongs behind an operator-controlled diagnostic path. |
| Sensitive-path redaction | End-user denial responses must not include relationship paths, sensitive subject identifiers, private group names, folder names, or decision IDs. |

## Test Suite

Run the focused conformance suite:

```sh
pnpm validate:pep-conformance
```

The suite exercises the TypeScript Express starter in `tests/sdk-pep/pep-conformance.test.ts` and the Python FastAPI starter in `tests/sdk-pep/python-fastapi-pep.test.ts`. Future SDKs and middleware examples should add their own adapter tests against the same behavior contract before they are marked reviewable in the backlog.

The conformance tests intentionally use protected requests with local role-like headers and sensitive relationship-path fixtures. Those inputs prove that the PEP does not authorize locally, does not call explain for protected route denials, and does not leak relationship paths in end-user responses.

## Implementation Notes

Application PEPs should keep Access Kit decisions and user-facing responses separate:

- Internal logs may retain decision IDs, reason codes, and correlation IDs for audit traceability.
- End-user denial bodies should contain only a stable denial code, a correlation ID, and a safe reason code.
- Relationship paths returned by explain are diagnostic evidence, not route error content.
- API client errors, network failures, parse failures, and authentication failures all deny protected access.

## Python FastAPI Starter

The Python starter lives in `examples/python-fastapi-pep/`. It provides a stdlib `AccessKitClient`, a FastAPI-compatible dependency factory, an exception handler for safe denial responses, and a policy-test CI script. The dependency calls `check` for protected routes, propagates or generates correlation IDs, emits decision events for application logging, and raises a denial instead of authorizing locally when Access Kit denies, rejects authentication, or is unavailable.

Use `client.explain()` only for operator-controlled diagnostics. The FastAPI dependency does not call explain and does not include relationship paths, private subject identifiers, group names, folder names, or decision IDs in end-user denial bodies.
