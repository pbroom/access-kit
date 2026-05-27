package accesskitextauthz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

type ExtAuthzConfig struct {
	BuildCorrelationID    func(*http.Request) string
	BuildDecisionRequest  func(*http.Request) (DecisionRequest, error)
	Client                *Client
	DecisionLogger        DecisionLogger
	GeneratedIDTimeSource func() time.Time
}

type DecisionLogger interface {
	LogDecision(context.Context, DecisionLogEntry)
}

type DecisionLogEntry struct {
	CorrelationID string `json:"correlationId"`
	DecisionID    string `json:"decisionId,omitempty"`
	Error         string `json:"error,omitempty"`
	Outcome       string `json:"outcome"`
	ReasonCode    string `json:"reasonCode,omitempty"`
}

type DecisionLogFunc func(context.Context, DecisionLogEntry)

func (logger DecisionLogFunc) LogDecision(ctx context.Context, entry DecisionLogEntry) {
	logger(ctx, entry)
}

type JSONDecisionLogger struct {
	Writer io.Writer
}

func (logger JSONDecisionLogger) LogDecision(_ context.Context, entry DecisionLogEntry) {
	writer := logger.Writer
	if writer == nil {
		writer = os.Stdout
	}
	_ = json.NewEncoder(writer).Encode(entry)
}

type DenialResponse struct {
	Code          string `json:"code"`
	CorrelationID string `json:"correlationId"`
	ReasonCode    string `json:"reasonCode"`
}

const TrustedSubjectHeader = "x-access-kit-trusted-subject"

func NewExtAuthzHandler(config ExtAuthzConfig) (http.Handler, error) {
	if config.Client == nil {
		return nil, errors.New("access kit client is required")
	}

	buildDecisionRequest := config.BuildDecisionRequest
	if buildDecisionRequest == nil {
		buildDecisionRequest = DefaultEnvoyDecisionRequest
	}

	buildCorrelationID := config.BuildCorrelationID
	now := config.GeneratedIDTimeSource
	if now == nil {
		now = time.Now
	}
	if buildCorrelationID == nil {
		buildCorrelationID = func(request *http.Request) string {
			return CorrelationIDFromRequest(request, now)
		}
	}

	logger := config.DecisionLogger
	if logger == nil {
		logger = JSONDecisionLogger{}
	}

	return &extAuthzHandler{
		buildCorrelationID:   buildCorrelationID,
		buildDecisionRequest: buildDecisionRequest,
		client:               config.Client,
		logger:               logger,
	}, nil
}

func DefaultEnvoyDecisionRequest(request *http.Request) (DecisionRequest, error) {
	action := actionFromMethod(request.Method)
	subjectID := firstHeader(request, TrustedSubjectHeader)
	resourceID := routeResourceID(request)

	if subjectID == "" {
		return DecisionRequest{}, fmt.Errorf("missing trusted subject header %s", TrustedSubjectHeader)
	}
	if resourceID == "" {
		return DecisionRequest{}, errors.New("missing route resource")
	}

	return DecisionRequest{
		Action:     action,
		ResourceID: resourceID,
		SubjectID:  subjectID,
	}, nil
}

func CorrelationIDFromRequest(request *http.Request, now func() time.Time) string {
	correlationID := strings.TrimSpace(request.Header.Get("x-correlation-id"))
	if correlationID != "" {
		return correlationID
	}

	return fmt.Sprintf("corr:go-envoy:%d", now().UnixNano())
}

type extAuthzHandler struct {
	buildCorrelationID   func(*http.Request) string
	buildDecisionRequest func(*http.Request) (DecisionRequest, error)
	client               *Client
	logger               DecisionLogger
}

func (handler *extAuthzHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.URL.Path == "/healthz" {
		response.WriteHeader(http.StatusNoContent)
		return
	}

	correlationID := handler.buildCorrelationID(request)
	response.Header().Set("x-correlation-id", correlationID)

	decisionRequest, err := handler.buildDecisionRequest(request)
	if err != nil {
		handler.logger.LogDecision(request.Context(), DecisionLogEntry{
			CorrelationID: correlationID,
			Error:         "invalid protected request",
			Outcome:       "error",
			ReasonCode:    "ACCESS_KIT_INVALID_REQUEST",
		})
		writeDeny(response, http.StatusForbidden, "ACCESS_KIT_INVALID_REQUEST", correlationID)
		return
	}

	decision, err := handler.client.Check(request.Context(), decisionRequest, RequestOptions{CorrelationID: correlationID})
	if err != nil {
		handler.logger.LogDecision(request.Context(), DecisionLogEntry{
			CorrelationID: correlationID,
			Error:         "access kit check failed",
			Outcome:       "error",
			ReasonCode:    "ACCESS_KIT_UNAVAILABLE",
		})
		writeDeny(response, http.StatusServiceUnavailable, "ACCESS_KIT_UNAVAILABLE", correlationID)
		return
	}

	if decision.Decision != "allow" {
		reasonCode := safeReasonCode(decision.ReasonCode, "DENY_DEFAULT_NO_RELATIONSHIP_PATH")
		handler.logger.LogDecision(request.Context(), DecisionLogEntry{
			CorrelationID: correlationID,
			DecisionID:    decision.DecisionID,
			Outcome:       "deny",
			ReasonCode:    reasonCode,
		})
		writeDeny(response, http.StatusForbidden, reasonCode, correlationID)
		return
	}

	handler.logger.LogDecision(request.Context(), DecisionLogEntry{
		CorrelationID: correlationID,
		DecisionID:    decision.DecisionID,
		Outcome:       "allow",
		ReasonCode:    decision.ReasonCode,
	})
	response.Header().Set("x-access-kit-decision-id", decision.DecisionID)
	response.WriteHeader(http.StatusOK)
}

func writeDeny(response http.ResponseWriter, status int, reasonCode string, correlationID string) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(DenialResponse{
		Code:          "ACCESS_DENIED",
		CorrelationID: correlationID,
		ReasonCode:    reasonCode,
	})
}

func firstHeader(request *http.Request, names ...string) string {
	for _, name := range names {
		value := strings.TrimSpace(request.Header.Get(name))
		if value != "" {
			return value
		}
	}

	return ""
}

func routeResourceID(request *http.Request) string {
	path := strings.TrimSpace(request.Header.Get("x-envoy-original-path"))
	if path == "" {
		path = request.URL.EscapedPath()
	}
	if path == "" {
		return ""
	}

	path = strings.Split(path, "?")[0]
	return "route:" + path
}

func actionFromMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return "read"
	default:
		return "write"
	}
}

var reasonCodePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{2,80}$`)

func safeReasonCode(value string, fallback string) string {
	if reasonCodePattern.MatchString(value) {
		return value
	}

	return fallback
}
