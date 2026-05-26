# Go Envoy Ext-Authz PEP Example

This example provides a dependency-free Go client and an Envoy HTTP `ext_authz` service for protected gateway routes. The service calls the local Access Kit API for every protected request, fails closed on API or authentication failure, propagates correlation IDs, and logs decision IDs internally without returning relationship paths to callers.

## Local API

Start the local API with a development key:

```sh
REBAC_API_KEYS=local-dev-key pnpm --filter @access-kit/api build
REBAC_API_KEYS=local-dev-key node packages/api/dist/bin.js
```

Run the Go example tests and policy-test CI command against that API when a Go toolchain is available:

```sh
cd examples/go-envoy-ext-authz
ACCESS_KIT_API_KEY=local-dev-key ACCESS_KIT_BASE_URL=http://127.0.0.1:3000 go test ./...
ACCESS_KIT_API_KEY=local-dev-key ACCESS_KIT_BASE_URL=http://127.0.0.1:3000 \
  go run ./cmd/policy-test-ci policy:local-rebac-v1
```

## Ext-Authz Service

```sh
cd examples/go-envoy-ext-authz
ACCESS_KIT_API_KEY=local-dev-key ACCESS_KIT_BASE_URL=http://127.0.0.1:3000 \
  go run ./cmd/ext-authz
```

Envoy can load `envoy.yaml` as a starter gateway. The ext-authz filter sets `failure_mode_allow: false`, so protected routes deny when Access Kit is unavailable, rejects authentication, or returns a deny decision.

The default request mapper reads `x-access-kit-subject` or `x-subject-id`, optional `x-access-kit-action`, and `x-access-kit-resource`. If an action header is missing, it maps safe HTTP methods to `read` and other methods to `write`. If a resource header is missing, it falls back to an Envoy route resource ID. The denial response still contains only:

```json
{
  "code": "ACCESS_DENIED",
  "correlationId": "corr:go-envoy:example",
  "reasonCode": "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
}
```

Relationship paths, sensitive subject IDs, route paths, and decision IDs stay out of user-facing denial bodies. Decision logs retain the decision ID, safe reason code, outcome, and correlation ID for internal audit correlation.

## Safe Explain Diagnostics

Protected ext-authz checks do not call `explain`. Operator-controlled diagnostics can call `ExplainDiagnostics`, which redacts the relationship path to metadata:

```go
diagnostics, err := client.ExplainDiagnostics(ctx, request, accesskitextauthz.RequestOptions{
	CorrelationID: "corr:diagnostic",
})
```

The diagnostic response includes policy and relationship versions plus the relationship path length, not the path entries themselves.
