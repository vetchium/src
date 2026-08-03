package orgsapi

import "backend/internal/apiserver"

type Server struct {
	*apiserver.Runtime

	// Things below come from Config
	TenantID string
}
