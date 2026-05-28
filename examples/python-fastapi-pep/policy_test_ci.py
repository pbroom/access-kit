"""Run Access Kit policy tests from Python CI jobs."""

import os
import sys

from access_kit_pep import AccessKitClient


def main() -> int:
    api_key = os.environ.get("ACCESS_KIT_API_KEY", "")
    base_url = os.environ.get("ACCESS_KIT_BASE_URL", "http://127.0.0.1:3000")
    policy_id = sys.argv[1] if len(sys.argv) > 1 else ""

    if not api_key:
        raise SystemExit("ACCESS_KIT_API_KEY is required.")

    if not policy_id:
        raise SystemExit("Usage: python3 examples/python-fastapi-pep/policy_test_ci.py <policy-id>")

    client = AccessKitClient(base_url=base_url, api_key=api_key)
    result = client.test_policy(policy_id, correlation_id="corr:python-policy-test-ci")
    checks = result.get("checks", [])
    failing_checks = [
        check for check in checks
        if isinstance(check, dict) and check.get("status") == "fail"
    ]

    if not result.get("valid") or failing_checks:
        raise SystemExit("Policy %s failed %s policy-test checks." % (policy_id, len(failing_checks)))

    print("PASS %s policy-test checks." % policy_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
