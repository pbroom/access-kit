# Python FastAPI PEP Starter

This starter shows a fail-closed policy enforcement point for FastAPI. It calls the local Access Kit API for every protected request and never authorizes from route-local roles, cached state, or framework guards.

The example is intentionally dependency-light. `access_kit_pep.py` uses the Python standard library for API calls and exposes FastAPI-compatible dependency helpers without requiring this repository to become a Python package.

## Local API

Start the local API with a development key in your shell or CI environment:

```sh
REBAC_API_KEYS=local-dev-key pnpm --filter @access-kit/api build
```

The example reads the key from `ACCESS_KIT_API_KEY`. Do not commit real tokens or put production credentials in example source.

## Protected Route

```py
import logging
import os

from fastapi import Depends, FastAPI, Request, Response

from access_kit_pep import (
    AccessKitClient,
    create_fastapi_pep_dependency,
    register_access_kit_exception_handler,
)

logger = logging.getLogger("access-kit.pep")
app = FastAPI()
register_access_kit_exception_handler(app)

access_kit = AccessKitClient(
    api_key=os.environ.get("ACCESS_KIT_API_KEY", ""),
    base_url=os.environ.get("ACCESS_KIT_BASE_URL", "http://127.0.0.1:3000"),
)


def log_decision(event):
    logger.info(
        "access_kit_pep_decision",
        extra={
            "correlation_id": event.correlation_id,
            "decision_id": (event.decision or {}).get("decisionId"),
            "outcome": event.outcome,
            "reason_code": (event.decision or {}).get("reasonCode"),
        },
    )


def subject_from_authenticated_session(request: Request) -> str:
    subject_id = getattr(request.state, "authenticated_subject_id", "")
    if not subject_id:
        raise RuntimeError("authenticated subject missing before Access Kit PEP")
    return str(subject_id)


require_case_plan_read = create_fastapi_pep_dependency(
    client=access_kit,
    build_decision_request=lambda request: {
        "subjectId": subject_from_authenticated_session(request),
        "action": "read",
        "resourceId": "document:case-plan",
    },
    on_decision=log_decision,
)


@app.get("/cases/case-plan")
def read_case_plan(
    _request: Request,
    _response: Response,
    _decision=Depends(require_case_plan_read),
):
    return {"id": "document:case-plan", "title": "Synthetic case plan"}
```

Run authentication middleware or a FastAPI dependency before the PEP and populate `request.state.authenticated_subject_id` from a verified session, JWT, mTLS gateway identity, or other trusted result. Do not map `subjectId` from caller-supplied headers such as `x-subject-id` or `x-user-id`; those headers are user-controlled unless a trusted gateway strips and reissues them before the request reaches FastAPI.

When Access Kit allows, the dependency returns the decision and the route handler runs. When Access Kit denies, rejects authentication, times out, or cannot be reached, the dependency raises `AccessKitPepDenied`; the registered handler returns a safe denial body with an `x-correlation-id` header.

End-user denial bodies contain only `code`, `correlationId`, and a safe `reasonCode`. The dependency does not call `explain`, does not expose decision IDs, and does not include relationship paths in route errors.

## Explain Diagnostics

Use `client.explain()` only in operator-controlled diagnostics, not inside protected route dependencies:

```py
diagnostic = access_kit.explain(
    {
        "subjectId": "user:alice",
        "action": "read",
        "resourceId": "document:case-plan",
    },
    correlation_id="corr:operator-diagnostic",
)
```

Treat explain output as sensitive evidence because relationship paths can include private subjects, groups, folders, and tenant-boundary details.

## Policy Test CI Example

Run the starter policy-test example against the local API:

```sh
ACCESS_KIT_API_KEY=local-dev-key ACCESS_KIT_BASE_URL=http://127.0.0.1:3000 \
  python3 examples/python-fastapi-pep/policy_test_ci.py policy:local-rebac-v1
```

The script exits non-zero when the local API cannot be reached, authentication fails, or the policy test response contains a failing check.

## Local Validation

Run the Python example tests directly:

```sh
python3 -m unittest discover -s examples/python-fastapi-pep -p 'test_*.py'
```

The repository SDK PEP test gate also runs these tests and a local API smoke check through Vitest:

```sh
pnpm test:sdk-pep
```
