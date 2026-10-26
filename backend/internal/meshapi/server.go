package meshapi

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"

	"backend/internal/apiserver"
	"backend/internal/conversationclient"
	"backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/federation/commands"
	"backend/internal/federation/events"
	"backend/internal/hubapplicationclient"
	"backend/internal/listingclient"
	"backend/internal/listings"
	"backend/internal/profileclient"
	"backend/internal/providerwork"
	"backend/internal/publicopeningclient"
	"backend/internal/publicopenings"
	"backend/internal/workclient"
)

type PictureSigner interface {
	SignGet(context.Context, pgtype.UUID) (string, error)
}

// OfferLetterSigner signs a short-lived read URL for an offer letter.
type OfferLetterSigner interface {
	SignOfferLetterGet(context.Context, pgtype.UUID) (string, error)
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
	// ListingPeers reads another tenant's Listings; PublicListings this
	// tenant's.
	ListingPeers   *listingclient.Client
	PublicListings listings.Reader
	// WorkPeers reads another tenant's provider work; ProviderWork answers
	// this tenant's own.
	WorkPeers         *workclient.Client
	ConversationPeers *conversationclient.Client
	ProviderWork      providerwork.Reader
	Pictures          PictureSigner
	OfferLetters      OfferLetterSigner
	Queries           sqlc.Querier
	Credential        string
	Commands          *commands.Executor
	CommandPeers      CommandPeers
	Events            *events.Receiver
	EventPeers        EventPeers
}
