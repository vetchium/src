// Command doh-dev serves DNS-over-HTTPS from the development DNS server so
// browsers can query it. It is built only into the development stacks.
package main

import (
	"errors"
	"log/slog"
	"os"
	"time"

	"backend/internal/devdoh"
	"backend/internal/service"
)

func main() {
	service.Main("doh-dev", run)
}

func run(log *slog.Logger, address string) error {
	upstream := os.Getenv("DOH_DEV_UPSTREAM")
	if upstream == "" {
		return errors.New("DOH_DEV_UPSTREAM is required")
	}
	ctx, stop := service.SignalContext()
	defer stop()
	return service.ListenAndServe(
		ctx, log, address, devdoh.Handler(upstream, 5*time.Second),
	)
}
