package meshapi

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/profileclient"
	"backend/internal/publicopeningclient"
	"backend/internal/publicopenings"
)

type PictureSigner interface {
	SignGet(context.Context, pgtype.UUID) (string, error)
}

type Server struct {
	*apiserver.Runtime

	// Values below come from the shared application config.
	TenantID       string
	Directory      *directoryclient.Client
	Profiles       *profileclient.Client
	Openings       *publicopeningclient.Client
	PublicOpenings publicopenings.Reader
	Pictures       PictureSigner
	Queries        sqlc.Querier
	Credential     string
}
