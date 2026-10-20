// Package eventkinds lists every outbox event kind with its receiver
// handler. mesh-api and workers both build their registry here, so an event
// applies the same way at a peer and in process. Register a new kind here.
package eventkinds

import (
	"backend/internal/engagements"
	"backend/internal/federation/events"
	"backend/internal/hubapplications"
)

func Registry() *events.Registry {
	registry := events.NewRegistry()
	hubapplications.Register(registry)
	engagements.RegisterEvents(registry)
	return registry
}
