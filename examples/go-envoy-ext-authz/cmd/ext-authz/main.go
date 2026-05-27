package main

import (
	"log"
	"net/http"
	"os"
	"time"

	accesskit "github.com/pbroom/access-kit/examples/go-envoy-ext-authz"
	"github.com/pbroom/access-kit/examples/go-envoy-ext-authz/internal/env"
)

func main() {
	client, err := accesskit.NewClient(accesskit.ClientConfig{
		APIKey:  os.Getenv("ACCESS_KIT_API_KEY"),
		BaseURL: env.OrDefault("ACCESS_KIT_BASE_URL", "http://127.0.0.1:3000"),
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

	address := env.OrDefault("EXT_AUTHZ_ADDR", "127.0.0.1:9000")
	log.Printf("listening on %s", address)
	server := &http.Server{
		Addr:         address,
		Handler:      handler,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
