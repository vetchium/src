package globalcoordinator

import (
	"backend/internal/apiserver"
	"backend/internal/globaldirectory"
)

type Server struct {
	*apiserver.Runtime
	Directory *globaldirectory.Service
}
