package hubapi

import "backend/internal/apiserver"

type Server struct {
	*apiserver.Runtime

	// Values below come from the shared application config.
	TenantID string
}
