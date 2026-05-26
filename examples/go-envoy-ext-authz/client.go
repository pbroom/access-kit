package accesskitextauthz

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type ClientConfig struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
}

type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

type RequestOptions struct {
	CorrelationID string
}

type DecisionRequest struct {
	Action     string         `json:"action"`
	Context    map[string]any `json:"context,omitempty"`
	ResourceID string         `json:"resourceId"`
	SubjectID  string         `json:"subjectId"`
}

type RelationshipPathEntry struct {
	ObjectID  string `json:"objectId"`
	Relation  string `json:"relation"`
	SubjectID string `json:"subjectId"`
}

type DecisionResult struct {
	Action              string                  `json:"action"`
	Constraints         map[string]any          `json:"constraints,omitempty"`
	Decision            string                  `json:"decision"`
	DecisionID          string                  `json:"decisionId"`
	EvaluatedAt         string                  `json:"evaluatedAt"`
	PolicyVersion       string                  `json:"policyVersion"`
	ReasonCode          string                  `json:"reasonCode"`
	RelationshipPath    []RelationshipPathEntry `json:"relationshipPath,omitempty"`
	RelationshipVersion string                  `json:"relationshipVersion"`
	ResourceID          string                  `json:"resourceId"`
	SubjectID           string                  `json:"subjectId"`
}

type DecisionDiagnostics struct {
	Decision               string `json:"decision"`
	DecisionID             string `json:"decisionId"`
	EvaluatedAt            string `json:"evaluatedAt"`
	HasRelationshipPath    bool   `json:"hasRelationshipPath"`
	PolicyVersion          string `json:"policyVersion"`
	ReasonCode             string `json:"reasonCode"`
	RelationshipPathLength int    `json:"relationshipPathLength"`
	RelationshipVersion    string `json:"relationshipVersion"`
}

type PolicyTestResult struct {
	Checks []PolicyTestCheck `json:"checks"`
	Valid  bool              `json:"valid"`
}

type PolicyTestCheck struct {
	Message string `json:"message"`
	Name    string `json:"name"`
	Status  string `json:"status"`
}

type ClientError struct {
	Code          string
	CorrelationID string
	RetryAfter    string
	StatusCode    int
}

func (err *ClientError) Error() string {
	if err.CorrelationID == "" {
		return fmt.Sprintf("%s (%d)", err.Code, err.StatusCode)
	}

	return fmt.Sprintf("%s (%d, correlationId=%s)", err.Code, err.StatusCode, err.CorrelationID)
}

func NewClient(config ClientConfig) (*Client, error) {
	if config.APIKey == "" {
		return nil, &ClientError{Code: "CLIENT_MISSING_API_KEY", StatusCode: http.StatusUnauthorized}
	}

	baseURL, err := normalizeBaseURL(config.BaseURL)
	if err != nil {
		return nil, &ClientError{Code: "CLIENT_INVALID_BASE_URL", StatusCode: http.StatusBadRequest}
	}

	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	return &Client{apiKey: config.APIKey, baseURL: baseURL, httpClient: httpClient}, nil
}

func (client *Client) Check(ctx context.Context, request DecisionRequest, options RequestOptions) (*DecisionResult, error) {
	var result DecisionResult
	if err := client.postJSON(ctx, "/v1/decision/check", request, options, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (client *Client) ExplainDiagnostics(ctx context.Context, request DecisionRequest, options RequestOptions) (*DecisionDiagnostics, error) {
	var result DecisionResult
	if err := client.postJSON(ctx, "/v1/decision/explain", request, options, &result); err != nil {
		return nil, err
	}

	return &DecisionDiagnostics{
		Decision:               result.Decision,
		DecisionID:             result.DecisionID,
		EvaluatedAt:            result.EvaluatedAt,
		HasRelationshipPath:    len(result.RelationshipPath) > 0,
		PolicyVersion:          result.PolicyVersion,
		ReasonCode:             result.ReasonCode,
		RelationshipPathLength: len(result.RelationshipPath),
		RelationshipVersion:    result.RelationshipVersion,
	}, nil
}

func (client *Client) ValidatePolicy(ctx context.Context, policyID string, options RequestOptions) (*PolicyTestResult, error) {
	if policyID == "" {
		return nil, &ClientError{Code: "CLIENT_MISSING_POLICY_ID", StatusCode: http.StatusBadRequest}
	}

	var result PolicyTestResult
	path := fmt.Sprintf("/v1/policies/%s/validate", url.PathEscape(policyID))
	if err := client.postJSON(ctx, path, map[string]string{"mode": "test"}, options, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (client *Client) postJSON(ctx context.Context, path string, body any, options RequestOptions, target any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("authorization", "Bearer "+client.apiKey)
	request.Header.Set("content-type", "application/json")
	if options.CorrelationID != "" {
		request.Header.Set("x-correlation-id", options.CorrelationID)
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return parseClientError(response)
	}

	return json.NewDecoder(response.Body).Decode(target)
}

func parseClientError(response *http.Response) error {
	errorBody := struct {
		Code          string `json:"code"`
		CorrelationID string `json:"correlationId"`
	}{}
	if err := json.NewDecoder(response.Body).Decode(&errorBody); err != nil && !errors.Is(err, context.Canceled) {
		errorBody.Code = fmt.Sprintf("HTTP_%d", response.StatusCode)
	}

	if errorBody.Code == "" {
		errorBody.Code = fmt.Sprintf("HTTP_%d", response.StatusCode)
	}

	return &ClientError{
		Code:          errorBody.Code,
		CorrelationID: errorBody.CorrelationID,
		RetryAfter:    response.Header.Get("retry-after"),
		StatusCode:    response.StatusCode,
	}
}

func normalizeBaseURL(value string) (string, error) {
	baseURL := strings.TrimRight(value, "/")
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("base URL must include scheme and host")
	}

	return baseURL, nil
}
