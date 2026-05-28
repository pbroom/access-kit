package main

import (
	"context"
	"fmt"
	"log"
	"os"

	accesskit "github.com/pbroom/access-kit/examples/go-envoy-ext-authz"
	"github.com/pbroom/access-kit/examples/go-envoy-ext-authz/internal/env"
)

func main() {
	policyID := os.Getenv("ACCESS_KIT_POLICY_ID")
	if len(os.Args) > 1 {
		policyID = os.Args[1]
	}
	if policyID == "" {
		log.Fatal("usage: policy-test-ci <policy-id>")
	}

	client, err := accesskit.NewClient(accesskit.ClientConfig{
		APIKey:  os.Getenv("ACCESS_KIT_API_KEY"),
		BaseURL: env.OrDefault("ACCESS_KIT_BASE_URL", "http://127.0.0.1:3000"),
	})
	if err != nil {
		log.Fatalf("access kit client setup failed: %v", err)
	}

	result, err := client.ValidatePolicy(context.Background(), policyID, accesskit.RequestOptions{
		CorrelationID: "corr:go-policy-test-ci",
	})
	if err != nil {
		log.Fatalf("policy validation failed closed: %v", err)
	}

	if !result.Valid {
		for _, check := range result.Checks {
			fmt.Printf("%s\t%s\t%s\n", check.Status, check.Name, check.Message)
		}
		os.Exit(1)
	}

	fmt.Printf("policy %s passed %d checks\n", policyID, len(result.Checks))
}
