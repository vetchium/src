package globalcoordinator

import "backend/internal/apiserver"

type Server struct {
	*apiserver.Runtime
	Generator  *Generator
	Credential string
}
