package meshapi

import "backend/internal/apiserver"
import "backend/internal/regions"

type Server struct {
	*apiserver.Runtime

	// Values below come from the shared application config.
	TenantID        string
	Regions         *regions.Catalog
	RegionDirectory regions.Directory
	Credential      string
}
