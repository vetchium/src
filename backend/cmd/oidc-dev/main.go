// Command oidc-dev serves the development and CI OpenID Connect provider.
// It is built only into the development stacks.
package main

import (
	"log/slog"
	"os"
	"strings"

	"backend/internal/oidc/mock"
	"backend/internal/service"
)

func main() {
	service.Main("oidc-dev", run)
}

func run(log *slog.Logger, address string) error {
	secret, err := os.ReadFile(os.Getenv("OIDC_CLIENT_SECRET_FILE"))
	if err != nil {
		return err
	}
	provider, err := mock.New(mock.Config{
		PublicURL:    os.Getenv("OIDC_PUBLIC_URL"),
		InternalURL:  os.Getenv("OIDC_INTERNAL_URL"),
		ClientID:     os.Getenv("OIDC_CLIENT_ID"),
		ClientSecret: strings.TrimRight(string(secret), "\r\n"),
		RedirectURI:  os.Getenv("OIDC_REDIRECT_URI"),
	})
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()
	return service.ListenAndServe(ctx, log, address, provider.Handler())
}
