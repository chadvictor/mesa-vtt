package main

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	addr := strings.TrimSpace(os.Getenv("LISTEN_ADDRESS"))
	if addr == "" {
		addr = ":8094"
	}
	target := "http://127.0.0.1" + addr + "/healthz"
	if !strings.HasPrefix(addr, ":") {
		target = "http://" + addr + "/healthz"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		os.Exit(1)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		os.Exit(1)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
