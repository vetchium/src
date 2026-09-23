// Command dev-seed applies local-development fixtures that must go through a
// portal API rather than straight into the database, so that the fixture is
// created by the same validation, authorization and audit path a real
// operator or user would use. Fixtures that are pure table content stay in
// db/db-seed instead.
//
// DEV_SEED_MODE selects which fixtures a run applies:
//   - "domains" (the default) seeds the admin-managed Hub signup domain
//     allowlist. It runs automatically as one dev-seed-<tenant> container per
//     `make dev`.
//   - "hub-profiles" seeds Hub user profiles from a hand-edited fixture file
//     under dev/hub-seed-profiles/. It runs on demand, from the host, via
//     `make dev-seed-hub-profiles`.
//
// It is never built into a production image and never deployed.
package main

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"backend/internal/service"
)

func main() {
	service.MainWithoutServer("dev-seed", run)
}

func run(log *slog.Logger) error {
	switch mode := strings.TrimSpace(os.Getenv("DEV_SEED_MODE")); mode {
	case "", "domains":
		return runDomainSeed(log)
	case "hub-profiles":
		return runHubProfileSeed(log)
	default:
		return fmt.Errorf("unknown DEV_SEED_MODE %q", mode)
	}
}
