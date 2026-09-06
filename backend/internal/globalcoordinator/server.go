package globalcoordinator

import "backend/internal/apiserver"
import "backend/internal/regions"

type Server struct {
	*apiserver.Runtime
	Regions    *regions.Catalog
	Generator  *Generator
	Credential string
}
