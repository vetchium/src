// Package chatmodel calls a model through the OpenAI-compatible chat
// completions protocol, which Docker Model Runner, vLLM, llama.cpp, and most
// hosted model APIs serve. It holds no credit or tenant policy.
package chatmodel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// maxResponseBytes bounds a model response; a draft is far smaller.
const maxResponseBytes = 1 << 20

// ErrModelFailed covers every way a call can end without a usable completion:
// a transport error, a timeout, a non-success status, or a malformed body.
var ErrModelFailed = errors.New("model call failed")

// Endpoint is one model on one server.
type Endpoint struct {
	BaseURL   string
	APIKey    string
	HostModel string
	// ChatTemplateKwargs is passed through when non-empty, for switches such
	// as turning off a model's thinking output.
	ChatTemplateKwargs json.RawMessage
	// JSONSchemaOutput asks the server to constrain output to the schema.
	JSONSchemaOutput bool
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Request struct {
	Messages  []Message
	MaxTokens int
	// JSONSchema, when set, describes the JSON object the answer must be.
	JSONSchema json.RawMessage
}

type Response struct {
	Content      string
	InputTokens  int
	OutputTokens int
}

type Client struct {
	HTTP *http.Client
}

func New() *Client {
	return &Client{HTTP: &http.Client{}}
}

type wireRequest struct {
	Model              string          `json:"model"`
	Messages           []Message       `json:"messages"`
	MaxTokens          int             `json:"max_tokens"`
	Temperature        float64         `json:"temperature"`
	Stream             bool            `json:"stream"`
	ResponseFormat     *responseFormat `json:"response_format,omitempty"`
	ChatTemplateKwargs json.RawMessage `json:"chat_template_kwargs,omitempty"`
}

type responseFormat struct {
	Type       string      `json:"type"`
	JSONSchema *jsonSchema `json:"json_schema,omitempty"`
}

type jsonSchema struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
}

type wireResponse struct {
	Choices []struct {
		Message struct {
			Content *string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     *int `json:"prompt_tokens"`
		CompletionTokens *int `json:"completion_tokens"`
	} `json:"usage"`
}

// Complete runs one non-streaming completion. Every failure wraps
// ErrModelFailed; a completion without token usage is a failure too, because
// it cannot be charged.
func (c *Client) Complete(
	ctx context.Context, endpoint Endpoint, request Request,
) (Response, error) {
	body := wireRequest{
		Model: endpoint.HostModel, Messages: request.Messages,
		MaxTokens: request.MaxTokens, Temperature: 0.3,
		ChatTemplateKwargs: endpoint.ChatTemplateKwargs,
	}
	if len(request.JSONSchema) > 0 {
		body.ResponseFormat = &responseFormat{Type: "json_object"}
		if endpoint.JSONSchemaOutput {
			body.ResponseFormat = &responseFormat{
				Type: "json_schema",
				JSONSchema: &jsonSchema{
					Name: "answer", Schema: request.JSONSchema,
				},
			}
		}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return Response{}, err
	}
	url := strings.TrimRight(endpoint.BaseURL, "/") + "/chat/completions"
	httpRequest, err := http.NewRequestWithContext(
		ctx, http.MethodPost, url, bytes.NewReader(encoded),
	)
	if err != nil {
		return Response{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	if endpoint.APIKey != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+endpoint.APIKey)
	}
	response, err := c.HTTP.Do(httpRequest)
	if err != nil {
		return Response{}, fmt.Errorf("%w: %w", ErrModelFailed, err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return Response{}, fmt.Errorf("%w: read body: %w", ErrModelFailed, err)
	}
	if response.StatusCode != http.StatusOK {
		return Response{}, fmt.Errorf(
			"%w: status %d", ErrModelFailed, response.StatusCode,
		)
	}
	if len(raw) > maxResponseBytes {
		return Response{}, fmt.Errorf("%w: response too large", ErrModelFailed)
	}
	var decoded wireResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return Response{}, fmt.Errorf("%w: decode: %w", ErrModelFailed, err)
	}
	if len(decoded.Choices) == 0 || decoded.Choices[0].Message.Content == nil {
		return Response{}, fmt.Errorf("%w: no completion", ErrModelFailed)
	}
	if decoded.Usage == nil || decoded.Usage.PromptTokens == nil ||
		decoded.Usage.CompletionTokens == nil ||
		*decoded.Usage.PromptTokens < 0 || *decoded.Usage.CompletionTokens < 0 {
		return Response{}, fmt.Errorf("%w: no token usage", ErrModelFailed)
	}
	return Response{
		Content:      StripThinking(*decoded.Choices[0].Message.Content),
		InputTokens:  *decoded.Usage.PromptTokens,
		OutputTokens: *decoded.Usage.CompletionTokens,
	}, nil
}

// StripThinking removes a leading <think>…</think> block, which reasoning
// models emit even when asked for JSON.
func StripThinking(content string) string {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "<think>") {
		return trimmed
	}
	end := strings.Index(trimmed, "</think>")
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(trimmed[end+len("</think>"):])
}
