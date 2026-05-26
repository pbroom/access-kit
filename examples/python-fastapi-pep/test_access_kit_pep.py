import json
import unittest
import urllib.error
import urllib.request

from access_kit_pep import (
    AccessKitClient,
    AccessKitClientError,
    AccessKitPepDenied,
    create_fastapi_pep_dependency,
)


PROTECTED_REQUEST = {
    "subjectId": "user:alice",
    "action": "read",
    "resourceId": "document:case-plan",
}

SENSITIVE_RELATIONSHIP_PATH = [
    {
        "subjectId": "user:executive@example.test",
        "relation": "member_of_sensitive_compensation_group",
        "objectId": "group:board-compensation-private",
    },
    {
        "subjectId": "group:board-compensation-private",
        "relation": "can_read_private_folder",
        "objectId": "folder:executive-compensation-plans",
    },
]


class AccessKitClientTests(unittest.TestCase):
    def test_checks_and_explains_allow_decisions(self):
        transport = RecordingTransport(
            [
                FakeHttpResponse(decision(decisionId="decision:python-check", relationshipPath=[])),
                FakeHttpResponse(decision(decisionId="decision:python-explain", relationshipPath=SENSITIVE_RELATIONSHIP_PATH)),
            ]
        )
        client = AccessKitClient(
            base_url="http://127.0.0.1:3000/",
            api_key="local-python-key",
            transport=transport,
        )

        check = client.check(PROTECTED_REQUEST, correlation_id="corr:python-check")
        explain = client.explain(PROTECTED_REQUEST, correlation_id="corr:python-explain")

        self.assertEqual(check["decision"], "allow")
        self.assertEqual(check["relationshipPath"], [])
        self.assertEqual(explain["decision"], "allow")
        self.assertGreater(len(explain["relationshipPath"]), 0)
        self.assertEqual(transport.calls[0]["x-correlation-id"], "corr:python-check")
        self.assertEqual(transport.calls[1]["x-correlation-id"], "corr:python-explain")

    def test_runs_policy_tests_through_the_client(self):
        transport = RecordingTransport([
            FakeHttpResponse({
                "valid": True,
                "checks": [{"name": "proof_points", "status": "pass", "message": "ok"}],
            })
        ])
        client = AccessKitClient("http://127.0.0.1:3000", "local-python-key", transport=transport)

        result = client.test_policy("policy:local-rebac-v1", correlation_id="corr:python-policy-test")

        self.assertEqual(result["valid"], True)
        self.assertEqual(transport.calls[0]["path"], "/v1/policies/policy%3Alocal-rebac-v1/validate")
        self.assertEqual(transport.calls[0]["body"], {"mode": "test"})

    def test_surfaces_api_authentication_failures_as_typed_errors(self):
        error = urllib.error.HTTPError(
            "http://127.0.0.1:3000/v1/decision/check",
            401,
            "Unauthorized",
            {},
            FakeBody({"code": "UNAUTHENTICATED", "correlationId": "corr:unauthenticated"}),
        )
        client = AccessKitClient(
            "http://127.0.0.1:3000",
            "wrong-python-key",
            transport=RecordingTransport([error]),
        )

        with self.assertRaises(AccessKitClientError) as caught:
            client.check(PROTECTED_REQUEST)

        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(caught.exception.code, "UNAUTHENTICATED")
        self.assertEqual(caught.exception.correlation_id, "corr:unauthenticated")

    def test_rejects_missing_client_credentials_before_protected_calls(self):
        with self.assertRaises(AccessKitClientError) as caught:
            AccessKitClient("http://127.0.0.1:3000", "")

        self.assertEqual(caught.exception.code, "CLIENT_MISSING_API_KEY")


class FastApiPepDependencyTests(unittest.TestCase):
    def test_fails_closed_when_access_kit_api_fails(self):
        client = MockClient(check_error=AccessKitClientError(503, "HTTP_503", "corr:api-outage"))
        events = []
        dependency = create_fastapi_pep_dependency(
            client,
            build_decision_request=lambda _request: PROTECTED_REQUEST,
            on_decision=events.append,
        )
        response = FakeResponse()

        with self.assertRaises(AccessKitPepDenied) as caught:
            dependency({"headers": {"x-correlation-id": "corr:pep-api-failure", "x-local-role": "admin"}}, response)

        self.assertEqual(client.check_calls, [(PROTECTED_REQUEST, "corr:pep-api-failure")])
        self.assertEqual(response.headers["x-correlation-id"], "corr:pep-api-failure")
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(
            caught.exception.body,
            {
                "code": "ACCESS_DENIED",
                "correlationId": "corr:pep-api-failure",
                "reasonCode": "ACCESS_KIT_UNAVAILABLE",
            },
        )
        self.assertEqual([(event.outcome, event.correlation_id) for event in events], [("error", "corr:pep-api-failure")])

    def test_propagates_correlation_ids_and_logs_allow_decisions(self):
        client = MockClient(check_result=decision(decisionId="decision:python-correlation"))
        events = []
        dependency = create_fastapi_pep_dependency(
            client,
            build_decision_request=lambda _request: PROTECTED_REQUEST,
            on_decision=events.append,
        )
        response = FakeResponse()

        result = dependency({"headers": {"x-correlation-id": "corr:caller-supplied"}}, response)

        self.assertEqual(result["decision"], "allow")
        self.assertEqual(client.check_calls, [(PROTECTED_REQUEST, "corr:caller-supplied")])
        self.assertEqual(response.headers["x-correlation-id"], "corr:caller-supplied")
        self.assertEqual(events[0].outcome, "allow")
        self.assertEqual(events[0].decision["decisionId"], "decision:python-correlation")
        self.assertEqual(events[0].decision["reasonCode"], "ALLOW_VIA_RELATIONSHIP_PATH")

    def test_logs_denied_decisions_with_reason_codes(self):
        client = MockClient(
            check_result=decision(
                decision="deny",
                decisionId="decision:python-deny",
                reasonCode="DENY_POLICY_CONSTRAINT",
            )
        )
        events = []
        dependency = create_fastapi_pep_dependency(
            client,
            build_decision_request=lambda _request: PROTECTED_REQUEST,
            on_decision=events.append,
        )

        with self.assertRaises(AccessKitPepDenied) as caught:
            dependency({"headers": {"x-correlation-id": "corr:python-deny"}}, FakeResponse())

        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.body["reasonCode"], "DENY_POLICY_CONSTRAINT")
        self.assertEqual(events[0].outcome, "deny")
        self.assertEqual(events[0].decision["decisionId"], "decision:python-deny")

    def test_does_not_substitute_local_authorization_fallback(self):
        client = MockClient(
            check_result=decision(
                decision="deny",
                decisionId="decision:python-no-fallback",
                reasonCode="DENY_DEFAULT_NO_RELATIONSHIP_PATH",
            )
        )
        dependency = create_fastapi_pep_dependency(client, build_decision_request=lambda _request: PROTECTED_REQUEST)

        with self.assertRaises(AccessKitPepDenied) as caught:
            dependency({
                "headers": {
                    "x-correlation-id": "corr:python-no-fallback",
                    "x-local-admin": "true",
                    "x-user-role": "owner",
                }
            })

        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.body["reasonCode"], "DENY_DEFAULT_NO_RELATIONSHIP_PATH")
        self.assertEqual(len(client.check_calls), 1)

    def test_does_not_call_explain_or_expose_debug_details_on_denials(self):
        client = MockClient(
            check_result=decision(
                decision="deny",
                decisionId="decision:python-debug-safe",
                reasonCode="DENY_TENANT_BOUNDARY",
                relationshipPath=SENSITIVE_RELATIONSHIP_PATH,
            ),
            explain_error=AssertionError("protected dependency called explain"),
        )
        dependency = create_fastapi_pep_dependency(client, build_decision_request=lambda _request: PROTECTED_REQUEST)

        with self.assertRaises(AccessKitPepDenied) as caught:
            dependency({
                "headers": {
                    "x-access-kit-debug": "explain",
                    "x-correlation-id": "corr:python-debug-safe",
                }
            })

        body = json.dumps(caught.exception.body)
        self.assertEqual(client.explain_calls, [])
        self.assertNotIn("relationshipPath", body)
        self.assertNotIn("decision:python-debug-safe", body)

    def test_redacts_sensitive_relationship_paths_from_denial_responses(self):
        client = MockClient(
            check_result=decision(
                decision="deny",
                decisionId="decision:python-sensitive-path",
                reasonCode="DENY_DEFAULT_NO_RELATIONSHIP_PATH",
                relationshipPath=SENSITIVE_RELATIONSHIP_PATH,
            )
        )
        dependency = create_fastapi_pep_dependency(client, build_decision_request=lambda _request: PROTECTED_REQUEST)

        with self.assertRaises(AccessKitPepDenied) as caught:
            dependency({"headers": {"x-correlation-id": "corr:python-sensitive-path"}})

        body = json.dumps(caught.exception.body)
        self.assertIn("DENY_DEFAULT_NO_RELATIONSHIP_PATH", body)
        self.assertNotIn("executive@example.test", body)
        self.assertNotIn("member_of_sensitive_compensation_group", body)
        self.assertNotIn("board-compensation-private", body)
        self.assertNotIn("executive-compensation-plans", body)


class MockClient:
    def __init__(self, check_result=None, check_error=None, explain_error=None):
        self.check_result = check_result or decision()
        self.check_error = check_error
        self.explain_error = explain_error
        self.check_calls = []
        self.explain_calls = []

    def check(self, request, correlation_id=None):
        self.check_calls.append((request, correlation_id))
        if self.check_error:
            raise self.check_error
        return self.check_result

    def explain(self, request, correlation_id=None):
        self.explain_calls.append((request, correlation_id))
        if self.explain_error:
            raise self.explain_error
        return decision()


class FakeResponse:
    def __init__(self):
        self.headers = {}


class FakeHttpResponse:
    def __init__(self, body, status=200):
        self.status = status
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def close(self):
        return None


class FakeBody:
    def __init__(self, body):
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def close(self):
        return None


class RecordingTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, request, _timeout):
        body = json.loads(request.data.decode("utf-8"))
        parsed = urllib.parse.urlparse(request.full_url)
        self.calls.append({
            "path": parsed.path,
            "body": body,
            "authorization": request.headers.get("Authorization"),
            "x-correlation-id": request.headers.get("X-correlation-id"),
        })
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def decision(**overrides):
    result = {
        "decisionId": "decision:python-allow",
        "decision": "allow",
        "subjectId": PROTECTED_REQUEST["subjectId"],
        "action": PROTECTED_REQUEST["action"],
        "resourceId": PROTECTED_REQUEST["resourceId"],
        "reasonCode": "ALLOW_VIA_RELATIONSHIP_PATH",
        "policyVersion": "policy:python-pep:v1",
        "relationshipVersion": "relationship:python-pep:v1",
        "relationshipPath": [],
        "constraints": {},
        "evaluatedAt": "2026-05-26T00:00:00.000Z",
    }
    result.update(overrides)
    return result


if __name__ == "__main__":
    unittest.main()
