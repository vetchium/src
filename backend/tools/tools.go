package tools

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func Register(mcpServer *mcp.Server) {
	registerEcho(mcpServer)
}
