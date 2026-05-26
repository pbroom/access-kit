package main

import (
	"log"
	"net/http"
	"os"

	accesskit "github.com/pbroom/access-kit/examples/go-envoy-ext-authz"
)

func main() {
	client, err := accesskit.NewClient(accesskit.ClientConfig{
		APIKey:  os.Getenv("ACCESS_KIT_API_KEY"),
		BaseURL: envOrDefault("ACCESS_KIT_BASE_URL", "http://127.0.0.1:3000"),
	})
	if err != nil {
		log.Fatalf("access kit client setup failed: %v", err)
	}

	handler, err := accesskit.NewExtAuthzHandler(accesskit.ExtAuthzConfig{
		Client:         client,
		DecisionLogger: accesskit.JSONDecisionLogger{},
	})
	if err != nil {
		log.Fatalf("ext-authz setup failed: %v", err)
	}

	address := envOrDefault("EXT_AUTHZ_ADDR", "127.0.0.1:9000")
	log.Printf("listening on %s", address)
	if err := http.ListenAndServe(address, handler); err != nil {
		log.Fatal(err)
	}
}

func envOrDefault(name string, fallback string) string {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}

	return value
}
