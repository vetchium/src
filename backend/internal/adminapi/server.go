package adminapi

import (
	"time"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type Server struct {
	*apiserver.Runtime

	Queries sqlc.Querier

	// Values below come from the shared application config.
	TenantID        string
	AdminSessionTTL time.Duration
}
