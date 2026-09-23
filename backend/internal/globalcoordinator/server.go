package globalcoordinator

import (
	"backend/internal/apiserver"
	"backend/internal/globaldirectory"
	"backend/internal/regions"
)

type Server struct {
	*apiserver.Runtime
	Regions   *regions.Catalog
	Directory *globaldirectory.Service
}
