package adminapi

import (
	"time"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type Server struct {
	*apiserver.Runtime

	Queries sqlc.Querier

	// Things below come from Config
	TenantID        string
	AdminSessionTTL time.Duration
}
