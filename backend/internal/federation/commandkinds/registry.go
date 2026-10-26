// Package commandkinds lists every durable command kind with its authority
// handler. hub-api, orgs-api, mesh-api, and workers all build their registry
// here, so a command initiated in one process executes the same way in
// process, at a peer, and on recovery. Register a new kind here.
package commandkinds

import (
	"backend/internal/agencyconversations"
	"backend/internal/engagements"
	"backend/internal/federation/commands"
	"backend/internal/hubapply"
	"backend/internal/hubconsent"
	"backend/internal/hubinterview"
	"backend/internal/huboffer"
	"backend/internal/hubwithdraw"
	"backend/internal/providerwork"
)

func Registry() *commands.Registry {
	registry := commands.NewRegistry()
	hubapply.Register(registry)
	hubwithdraw.Register(registry)
	huboffer.Register(registry)
	hubinterview.Register(registry)
	hubconsent.Register(registry)
	engagements.Register(registry)
	providerwork.Register(registry)
	agencyconversations.Register(registry)
	return registry
}
