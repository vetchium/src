package globalcoordinator

import (
	"backend/internal/apiserver"
	"backend/internal/regions"
)

type Server struct {
	*apiserver.Runtime
	Regions    *regions.Catalog
	Credential string
}
