package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
)

const healthProcedure = "/otto.v1.HealthService/Check"

type healthCheckRequest struct{}

type healthCheckResponse struct {
	Status string `json:"status"`
}

func main() {
	mux := http.NewServeMux()

	mux.Handle(healthProcedure, connect.NewUnaryHandler(healthProcedure, func(ctx context.Context, _ *connect.Request[healthCheckRequest]) (*connect.Response[healthCheckResponse], error) {
		resp := connect.NewResponse(&healthCheckResponse{Status: "SERVING"})
		resp.Header().Set("Cache-Control", "no-store")
		return resp, nil
	}))

	addr := ":5234"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           corsMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("Starting ConnectRPC service on %s", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowedHeaders := []string{
			"Content-Type",
			"Authorization",
			"Connect-Protocol-Version",
			"connect-protocol-version",
			"Connect-Timeout-Ms",
			"Connect-User-Agent",
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", strings.Join(allowedHeaders, ", "))
		w.Header().Set("Access-Control-Expose-Headers", "Content-Type, Connect-Protocol-Version")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
