"""Dependency-light Python client and FastAPI PEP helpers for Access Kit."""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Mapping, MutableMapping, Optional

try:
    from fastapi import Request as FastApiRequest
    from fastapi import Response as FastApiResponse
except Exception:
    FastApiRequest = Any
    FastApiResponse = Any


JsonObject = Mapping[str, Any]
MutableJsonObject = MutableMapping[str, Any]
DecisionRequest = Mapping[str, Any]
DecisionResult = MutableMapping[str, Any]
PolicyTestResult = MutableMapping[str, Any]


class AccessKitClientError(Exception):
    """Typed Access Kit client error that keeps correlation metadata available."""

    def __init__(
        self,
        status: int,
        code: str,
        correlation_id: Optional[str] = None,
        retry_after: Optional[str] = None,
    ) -> None:
        super().__init__("%s (%s)" % (code, status))
        self.status = status
        self.code = code
        self.correlation_id = correlation_id
        self.retry_after = retry_after


class AccessKitPepDenied(Exception):
    """Raised by the FastAPI dependency when a protected request must stop."""

    def __init__(self, status_code: int, body: JsonObject, headers: Mapping[str, str]) -> None:
        super().__init__("%s (%s)" % (body.get("reasonCode", "ACCESS_DENIED"), status_code))
        self.status_code = status_code
        self.body = dict(body)
        self.headers = dict(headers)


@dataclass(frozen=True)
class PepDecisionEvent:
    request: Any
    correlation_id: str
    outcome: str
    decision: Optional[DecisionResult] = None
    error: Optional[BaseException] = None


class AccessKitClient:
    """Small stdlib HTTP client for the local Access Kit API."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 5.0,
        transport: Optional[Callable[[urllib.request.Request, float], Any]] = None,
    ) -> None:
        if not api_key:
            raise AccessKitClientError(401, "CLIENT_MISSING_API_KEY")

        self.base_url = _normalize_base_url(base_url)
        self.api_key = api_key
        self.timeout = timeout
        self._transport = transport

    def check(self, request: DecisionRequest, correlation_id: Optional[str] = None) -> DecisionResult:
        return self._post_json("/v1/decision/check", request, correlation_id)

    def explain(self, request: DecisionRequest, correlation_id: Optional[str] = None) -> DecisionResult:
        return self._post_json("/v1/decision/explain", request, correlation_id)

    def test_policy(self, policy_id: str, correlation_id: Optional[str] = None) -> PolicyTestResult:
        path = "/v1/policies/%s/validate" % urllib.parse.quote(policy_id, safe="")
        return self._post_json(path, {"mode": "test"}, correlation_id)

    def _post_json(self, path: str, body: JsonObject, correlation_id: Optional[str]) -> MutableJsonObject:
        payload = json.dumps(body).encode("utf-8")
        headers = {
            "authorization": "Bearer %s" % self.api_key,
            "content-type": "application/json",
        }

        if correlation_id:
            headers["x-correlation-id"] = correlation_id

        request = urllib.request.Request(
            "%s%s" % (self.base_url, path),
            data=payload,
            headers=headers,
            method="POST",
        )

        try:
            response = self._open(request)
            try:
                status = _response_status(response)
                raw_body = response.read()
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()
        except urllib.error.HTTPError as error:
            raise _client_error_from_http_error(error, correlation_id)
        except (TimeoutError, urllib.error.URLError, OSError) as error:
            raise AccessKitClientError(503, "ACCESS_KIT_UNAVAILABLE", correlation_id) from error

        if status >= 400:
            raise AccessKitClientError(status, "HTTP_%s" % status, correlation_id)

        return _decode_json_response(raw_body, correlation_id)

    def _open(self, request: urllib.request.Request) -> Any:
        if self._transport is not None:
            return self._transport(request, self.timeout)

        return urllib.request.urlopen(request, timeout=self.timeout)


def create_fastapi_pep_dependency(
    client: AccessKitClient,
    build_decision_request: Callable[[Any], DecisionRequest],
    build_correlation_id: Optional[Callable[[Any], Optional[str]]] = None,
    on_decision: Optional[Callable[[PepDecisionEvent], None]] = None,
) -> Callable[[FastApiRequest, FastApiResponse], DecisionResult]:
    """Create a FastAPI dependency that fails closed for protected routes."""

    def require_access_kit(request: FastApiRequest, response: FastApiResponse = None) -> DecisionResult:
        correlation_id = _resolve_correlation_id(request, build_correlation_id)
        _set_response_header(response, "x-correlation-id", correlation_id)

        try:
            decision_request = build_decision_request(request)
            decision = client.check(decision_request, correlation_id=correlation_id)
        except Exception as error:
            _emit_decision(on_decision, request, correlation_id, "error", error=error)
            _deny(503, "ACCESS_KIT_UNAVAILABLE", correlation_id)

        if decision.get("decision") != "allow":
            reason_code = _safe_reason_code(decision.get("reasonCode"))
            _emit_decision(on_decision, request, correlation_id, "deny", decision=decision)
            _deny(403, reason_code, correlation_id)

        _emit_decision(on_decision, request, correlation_id, "allow", decision=decision)
        return decision

    return require_access_kit


def register_access_kit_exception_handler(app: Any) -> None:
    """Register a FastAPI handler that returns the safe PEP denial body."""

    from fastapi.responses import JSONResponse

    @app.exception_handler(AccessKitPepDenied)
    async def access_kit_pep_denied(_request: Any, error: AccessKitPepDenied) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content=error.body, headers=error.headers)


def _deny(status_code: int, reason_code: str, correlation_id: str) -> None:
    body = {
        "code": "ACCESS_DENIED",
        "correlationId": correlation_id,
        "reasonCode": reason_code,
    }
    raise AccessKitPepDenied(status_code, body, {"x-correlation-id": correlation_id})


def _emit_decision(
    on_decision: Optional[Callable[[PepDecisionEvent], None]],
    request: Any,
    correlation_id: str,
    outcome: str,
    decision: Optional[DecisionResult] = None,
    error: Optional[BaseException] = None,
) -> None:
    if on_decision is not None:
        on_decision(PepDecisionEvent(request, correlation_id, outcome, decision=decision, error=error))


def _resolve_correlation_id(
    request: Any,
    build_correlation_id: Optional[Callable[[Any], Optional[str]]],
) -> str:
    if build_correlation_id is not None:
        candidate = build_correlation_id(request)
        if candidate:
            return str(candidate)

    header = _get_header(request, "x-correlation-id")
    if isinstance(header, (list, tuple)):
        header = header[0] if header else None

    if header:
        return str(header)

    return "corr:python-pep:%s" % int(time.time() * 1000)


def _get_header(request: Any, name: str) -> Optional[Any]:
    headers = None
    if isinstance(request, Mapping):
        headers = request.get("headers")
    else:
        headers = getattr(request, "headers", None)

    if headers is None or not hasattr(headers, "get"):
        return None

    return headers.get(name) or headers.get(name.lower()) or headers.get(name.title())


def _set_response_header(response: Any, name: str, value: str) -> None:
    if response is None:
        return

    headers = getattr(response, "headers", None)
    if headers is not None:
        headers[name] = value
        return

    if isinstance(response, MutableMapping):
        response_headers = response.setdefault("headers", {})
        if isinstance(response_headers, MutableMapping):
            response_headers[name] = value


def _safe_reason_code(value: Any) -> str:
    if isinstance(value, str) and value:
        return value

    return "DENY_DEFAULT"


def _normalize_base_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        raise AccessKitClientError(400, "CLIENT_INVALID_BASE_URL")

    return value.rstrip("/")


def _response_status(response: Any) -> int:
    status = getattr(response, "status", None)
    if isinstance(status, int):
        return status

    getcode = getattr(response, "getcode", None)
    if callable(getcode):
        return int(getcode())

    return 200


def _decode_json_response(raw_body: bytes, correlation_id: Optional[str]) -> MutableJsonObject:
    try:
        body = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AccessKitClientError(502, "ACCESS_KIT_INVALID_RESPONSE", correlation_id) from error

    if not isinstance(body, MutableMapping):
        raise AccessKitClientError(502, "ACCESS_KIT_INVALID_RESPONSE", correlation_id)

    return body


def _client_error_from_http_error(
    error: urllib.error.HTTPError,
    fallback_correlation_id: Optional[str],
) -> AccessKitClientError:
    raw_body = error.read()
    retry_after = error.headers.get("retry-after") if error.headers is not None else None

    try:
        body = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        body = {}

    code = body.get("code") if isinstance(body, MutableMapping) else None
    correlation_id = body.get("correlationId") if isinstance(body, MutableMapping) else None

    return AccessKitClientError(
        error.code,
        code if isinstance(code, str) else "HTTP_%s" % error.code,
        correlation_id if isinstance(correlation_id, str) else fallback_correlation_id,
        retry_after,
    )
