// Package commandkinds lists every durable command kind with its authority
// handler. hub-api, orgs-api, mesh-api, and workers all build their registry
// here, so a command initiated in one process executes the same way in
// process, at a peer, and on recovery. Register a new kind here.
package commandkinds

import "backend/internal/federation/commands"

func Registry() *commands.Registry {
	return commands.NewRegistry()
}
