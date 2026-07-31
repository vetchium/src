package tools

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"backend/internal/server"
)

func Register(mcpServer *mcp.Server, s *server.Server) {
	registerEcho(mcpServer)
}
