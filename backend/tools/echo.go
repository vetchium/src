package tools

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type echoInput struct {
	Message string `json:"message" jsonschema:"the message to echo back"`
}

type echoOutput struct {
	Message string `json:"message" jsonschema:"the echoed message"`
}

func registerEcho(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "echo",
		Description: "Echo a message back, for connectivity checks.",
	}, func(
		_ context.Context, _ *mcp.CallToolRequest, input echoInput,
	) (*mcp.CallToolResult, echoOutput, error) {
		return nil, echoOutput(input), nil
	})
}
