package accesskitextauthz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientCheckAndExplainDiagnosticsUseLocalAPI(t *testing.T) {
	var checkCorrelationID string
	var explainCorrelationID string
	api := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("authorization") != "Bearer local-dev-key" {
			writeTestJSON(response, http.StatusUnauthorized, map[string]string{
				"code":          "UNAUTHENTICATED",
				"correlationId": "corr:auth:missing",
			})
			return
		}

		switch request.URL.Path {
		case "/v1/decision/check":
			checkCorrelationID = request.Header.Get("x-correlation-id")
			writeTestJSON(response, http.StatusOK, allowDecision("decision:go-check"))
		case "/v1/decision/explain":
			explainCorrelationID = request.Header.Get("x-correlation-id")
			decision := allowDecision("decision:go-explain")
			decision.RelationshipPath = []RelationshipPathEntry{{
				SubjectID: "user:executive@example.test",
				Relation:  "member_of_sensitive_compensation_group",
				ObjectID:  "group:board-compensation-private",
			}}
			writeTestJSON(response, http.StatusOK, decision)
		default:
			t.Fatalf("unexpected API path: %s", request.URL.Path)
		}
	}))
	defer api.Close()

	client := newTestClient(t, api.URL, "local-dev-key")
	request := DecisionRequest{SubjectID: "user:alice", Action: "read", ResourceID: "document:case-plan"}

	decision, err := client.Check(context.Background(), request, RequestOptions{CorrelationID: "corr:go-check"})
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}
	if decision.Decision != "allow" || checkCorrelationID != "corr:go-check" {
		t.Fatalf("check did not propagate allow decision and correlation ID: %+v corr=%s", decision, checkCorrelationID)
	}

	diagnostics, err := client.ExplainDiagnostics(context.Background(), request, RequestOptions{CorrelationID: "corr:go-explain"})
	if err != nil {
		t.Fatalf("explain diagnostics failed: %v", err)
	}
	diagnosticJSON := fmt.Sprintf("%+v", diagnostics)
	if diagnostics.RelationshipPathLength != 1 || !diagnostics.HasRelationshipPath || explainCorrelationID != "corr:go-explain" {
		t.Fatalf("diagnostics did not keep safe path metadata: %+v corr=%s", diagnostics, explainCorrelationID)
	}
	if strings.Contains(diagnosticJSON, "executive@example.test") || strings.Contains(diagnosticJSON, "board-compensation-private") {
		t.Fatalf("diagnostics leaked sensitive relationship path: %s", diagnosticJSON)
	}
}

func TestClientSurfacesAuthenticationFailure(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		writeTestJSON(response, http.StatusUnauthorized, map[string]string{
			"code":          "UNAUTHENTICATED",
			"correlationId": "corr:auth:missing",
		})
	}))
	defer api.Close()

	client := newTestClient(t, api.URL, "wrong-key")
	_, err := client.Check(context.Background(), DecisionRequest{SubjectID: "user:alice", Action: "read", ResourceID: "document:case-plan"}, RequestOptions{})
	var clientError *ClientError
	if !errors.As(err, &clientError) {
		t.Fatalf("expected ClientError, got %T: %v", err, err)
	}
	if clientError.StatusCode != http.StatusUnauthorized || clientError.Code != "UNAUTHENTICATED" || clientError.CorrelationID != "corr:auth:missing" {
		t.Fatalf("unexpected authentication error: %+v", clientError)
	}
}

func TestExtAuthzPropagatesCorrelationIDsAndLogsAllowDecisions(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/decision/check" {
			t.Fatalf("protected ext-authz flow called unexpected path: %s", request.URL.Path)
		}
		if request.Header.Get("x-correlation-id") != "corr:go-allow" {
			t.Fatalf("correlation ID was not forwarded to Access Kit")
		}
		writeTestJSON(response, http.StatusOK, allowDecision("decision:go-allow"))
	}))
	defer api.Close()

	events := []DecisionLogEntry{}
	handler := newTestHandler(t, api.URL, func(_ context.Context, entry DecisionLogEntry) {
		events = append(events, entry)
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/authorize", nil)
	request.Header.Set("x-correlation-id", "corr:go-allow")
	request.Header.Set("x-subject-id", "user:alice")
	request.Header.Set("x-access-kit-resource", "document:case-plan")

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || response.Header().Get("x-correlation-id") != "corr:go-allow" {
		t.Fatalf("allow response did not preserve correlation ID: code=%d headers=%v", response.Code, response.Header())
	}
	if len(events) != 1 || events[0].Outcome != "allow" || events[0].DecisionID != "decision:go-allow" {
		t.Fatalf("allow decision was not logged safely: %+v", events)
	}
}

func TestExtAuthzDeniesByDefaultAndRedactsSensitivePaths(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		decision := allowDecision("decision:go-deny")
		decision.Decision = "deny"
		decision.ReasonCode = "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
		decision.RelationshipPath = []RelationshipPathEntry{{
			SubjectID: "user:executive@example.test",
			Relation:  "member_of_sensitive_compensation_group",
			ObjectID:  "folder:executive-compensation-plans",
		}}
		writeTestJSON(response, http.StatusOK, decision)
	}))
	defer api.Close()

	events := []DecisionLogEntry{}
	handler := newTestHandler(t, api.URL, func(_ context.Context, entry DecisionLogEntry) {
		events = append(events, entry)
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/authorize", nil)
	request.Header.Set("x-correlation-id", "corr:go-deny")
	request.Header.Set("x-local-admin", "true")
	request.Header.Set("x-subject-id", "user:external-reviewer")
	request.Header.Set("x-access-kit-resource", "document:case-plan")

	handler.ServeHTTP(response, request)

	body := response.Body.String()
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected deny response, got %d: %s", response.Code, body)
	}
	if !strings.Contains(body, "DENY_DEFAULT_NO_RELATIONSHIP_PATH") || !strings.Contains(body, "corr:go-deny") {
		t.Fatalf("denial did not preserve safe reason and correlation ID: %s", body)
	}
	for _, sensitive := range []string{"executive@example.test", "member_of_sensitive_compensation_group", "executive-compensation-plans", "decision:go-deny"} {
		if strings.Contains(body, sensitive) {
			t.Fatalf("denial response leaked %q: %s", sensitive, body)
		}
	}
	if len(events) != 1 || events[0].Outcome != "deny" || events[0].DecisionID != "decision:go-deny" {
		t.Fatalf("deny decision was not logged internally: %+v", events)
	}
}

func TestExtAuthzFailsClosedWhenAccessKitFails(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		writeTestJSON(response, http.StatusUnauthorized, map[string]string{
			"code":          "UNAUTHENTICATED",
			"correlationId": "corr:auth:missing",
		})
	}))
	defer api.Close()

	handler := newTestHandler(t, api.URL, nil)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/authorize", nil)
	request.Header.Set("x-correlation-id", "corr:go-auth-failure")
	request.Header.Set("x-subject-id", "user:alice")
	request.Header.Set("x-access-kit-resource", "document:case-plan")

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("auth failure should fail closed for protected routes, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "ACCESS_KIT_UNAVAILABLE") {
		t.Fatalf("auth failure did not return unavailable denial: %s", response.Body.String())
	}
}

func TestExtAuthzGeneratesStableRequestCorrelationID(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		writeTestJSON(response, http.StatusOK, allowDecision("decision:generated-correlation"))
	}))
	defer api.Close()

	client := newTestClient(t, api.URL, "local-dev-key")
	handler, err := NewExtAuthzHandler(ExtAuthzConfig{
		Client:                client,
		GeneratedIDTimeSource: func() time.Time { return time.Unix(0, 42) },
	})
	if err != nil {
		t.Fatalf("handler setup failed: %v", err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/authorize", nil)
	request.Header.Set("x-subject-id", "user:alice")
	request.Header.Set("x-access-kit-resource", "document:case-plan")

	handler.ServeHTTP(response, request)

	if response.Header().Get("x-correlation-id") != "corr:go-envoy:42" {
		t.Fatalf("generated correlation ID was not stable for request: %s", response.Header().Get("x-correlation-id"))
	}
}

func newTestClient(t *testing.T, baseURL string, apiKey string) *Client {
	t.Helper()
	client, err := NewClient(ClientConfig{APIKey: apiKey, BaseURL: baseURL, HTTPClient: http.DefaultClient})
	if err != nil {
		t.Fatalf("client setup failed: %v", err)
	}

	return client
}

func newTestHandler(t *testing.T, baseURL string, logFunc func(context.Context, DecisionLogEntry)) http.Handler {
	t.Helper()
	client := newTestClient(t, baseURL, "local-dev-key")
	logger := DecisionLogger(JSONDecisionLogger{})
	if logFunc != nil {
		logger = DecisionLogFunc(logFunc)
	}
	handler, err := NewExtAuthzHandler(ExtAuthzConfig{
		Client:         client,
		DecisionLogger: logger,
	})
	if err != nil {
		t.Fatalf("handler setup failed: %v", err)
	}

	return handler
}

func allowDecision(decisionID string) DecisionResult {
	return DecisionResult{
		Action:              "read",
		Decision:            "allow",
		DecisionID:          decisionID,
		EvaluatedAt:         "2026-05-26T00:00:00.000Z",
		PolicyVersion:       "policy:pep-conformance:v1",
		ReasonCode:          "ALLOW_VIA_RELATIONSHIP_PATH",
		RelationshipVersion: "relationship:pep-conformance:v1",
		ResourceID:          "document:case-plan",
		SubjectID:           "user:alice",
	}
}

func writeTestJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}
