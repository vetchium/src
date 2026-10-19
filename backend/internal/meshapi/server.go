package meshapi

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/federation/commands"
	"backend/internal/federation/events"
	"backend/internal/hubapplicationclient"
	"backend/internal/profileclient"
	"backend/internal/publicopeningclient"
	"backend/internal/publicopenings"
)

type PictureSigner interface {
	SignGet(context.Context, pgtype.UUID) (string, error)
}

// CommandPeers sends a command to another tenant's peer listener.
type CommandPeers interface {
	Execute(
		context.Context, directoryspec.TenantID,
		federationspec.ExecuteCommandRequest,
	) (commands.PeerOutcome, error)
}

// EventPeers delivers an outbox event to another tenant's peer listener.
type EventPeers interface {
	Deliver(
		context.Context, directoryspec.TenantID,
		federationspec.DeliverEventRequest,
	) (events.Delivery, error)
}

type Server struct {
	*apiserver.Runtime

	// Values below come from the shared application config.
	TenantID       string
	Directory      *directoryclient.Client
	Profiles       *profileclient.Client
	Openings       *publicopeningclient.Client
	Applications   *hubapplicationclient.Client
	PublicOpenings publicopenings.Reader
	Pictures       PictureSigner
	Queries        sqlc.Querier
	Credential     string
	Commands       *commands.Executor
	CommandPeers   CommandPeers
	Events         *events.Receiver
	EventPeers     EventPeers
}
