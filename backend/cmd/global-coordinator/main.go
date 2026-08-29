package main

import (
	"log/slog"
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/globalcoordinator"
	"backend/internal/middleware"
	"backend/internal/routes"
	"backend/internal/service"
)

func main() {
	service.Main("global-coordinator", run)
}

func run(log *slog.Logger, address string) error {
	config, err := globalcoordinator.LoadConfig()
	if err != nil {
		return err
	}
	credential, err := globalcoordinator.LoadCredential(config.CredentialFile)
	if err != nil {
		return err
	}
	generator, err := globalcoordinator.OpenGenerator(config.StateFile)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := generator.Close(); closeErr != nil {
			log.Error(
				"close short ID generator",
				"event", "generator_close_error",
				"error", closeErr,
			)
		}
	}()

	ctx, stop := service.SignalContext()
	defer stop()

	runtime := apiserver.New(nil, log)
	server := &globalcoordinator.Server{
		Runtime:    runtime,
		Generator:  generator,
		Credential: credential,
	}
	mux := http.NewServeMux()
	routes.RegisterGlobalCoordinatorRoutes(mux, server)

	return service.ListenAndServe(
		ctx, log, address, middleware.RequestLogger(runtime)(mux),
	)
}
