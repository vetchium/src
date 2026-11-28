// Package eventkinds lists every outbox event kind with its receiver
// handler. mesh-api and workers both build their registry here, so an event
// applies the same way at a peer and in process. Register a new kind here.
package eventkinds

import (
	"backend/internal/agencycontacts"
	"backend/internal/engagements"
	"backend/internal/federation/events"
	"backend/internal/hubapplications"
	"backend/internal/hubreplies"
)

func Registry() *events.Registry {
	registry := events.NewRegistry()
	hubapplications.Register(registry)
	engagements.RegisterEvents(registry)
	agencycontacts.RegisterEvents(registry)
	hubreplies.RegisterEvents(registry)
	return registry
}
