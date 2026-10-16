package chatmodel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func serve(t *testing.T, status int, body string, seen *map[string]any) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/engines/v1/chat/completions" {
				t.Errorf("path = %q", r.URL.Path)
			}
			if r.Header.Get("Authorization") != "Bearer key" {
				t.Errorf("authorization = %q", r.Header.Get("Authorization"))
			}
			if seen != nil {
				_ = json.NewDecoder(r.Body).Decode(seen)
			}
			w.WriteHeader(status)
			_, _ = w.Write([]byte(body))
		}))
	t.Cleanup(server.Close)
	return server.URL + "/engines/v1/"
}

func TestCompleteSendsSchemaAndReadsUsage(t *testing.T) {
	t.Parallel()
	var seen map[string]any
	base := serve(t, http.StatusOK, `{"choices":[{"message":{"content":"<think>x</think> {\"a\":1}"}}],"usage":{"prompt_tokens":12,"completion_tokens":5}}`, &seen)
	response, err := New().Complete(context.Background(), Endpoint{
		BaseURL: base, APIKey: "key", HostModel: "ai/qwen3:1.7b",
		ChatTemplateKwargs: json.RawMessage(`{"enable_thinking":false}`),
		JSONSchemaOutput:   true,
	}, Request{
		Messages:   []Message{{Role: "user", Content: "hi"}},
		MaxTokens:  100,
		JSONSchema: json.RawMessage(`{"type":"object"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Content != `{"a":1}` || response.InputTokens != 12 || response.OutputTokens != 5 {
		t.Fatalf("response = %+v", response)
	}
	format, _ := seen["response_format"].(map[string]any)
	if seen["model"] != "ai/qwen3:1.7b" || seen["stream"] != false ||
		format["type"] != "json_schema" || seen["chat_template_kwargs"] == nil {
		t.Fatalf("request = %v", seen)
	}
}

func TestCompleteWithoutSchemaSupportAsksForJSONObject(t *testing.T) {
	t.Parallel()
	var seen map[string]any
	base := serve(t, http.StatusOK, `{"choices":[{"message":{"content":"{}"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`, &seen)
	if _, err := New().Complete(context.Background(), Endpoint{BaseURL: base, APIKey: "key"},
		Request{JSONSchema: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	format, _ := seen["response_format"].(map[string]any)
	if format["type"] != "json_object" || seen["chat_template_kwargs"] != nil {
		t.Fatalf("request = %v", seen)
	}
}

func TestCompleteFailures(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		status int
		body   string
	}{
		{"server error", http.StatusInternalServerError, `{}`},
		{"not JSON", http.StatusOK, `nope`},
		{"no choices", http.StatusOK, `{"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}`},
		{"no usage", http.StatusOK, `{"choices":[{"message":{"content":"{}"}}]}`},
		{"partial usage", http.StatusOK, `{"choices":[{"message":{"content":"{}"}}],"usage":{"prompt_tokens":1}}`},
		{"null content", http.StatusOK, `{"choices":[{"message":{"content":null}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			base := serve(t, testCase.status, testCase.body, nil)
			_, err := New().Complete(context.Background(),
				Endpoint{BaseURL: base, APIKey: "key"}, Request{})
			if !errors.Is(err, ErrModelFailed) {
				t.Fatalf("Complete() error = %v, want ErrModelFailed", err)
			}
		})
	}
}

func TestCompleteUnreachableServer(t *testing.T) {
	t.Parallel()
	_, err := New().Complete(context.Background(),
		Endpoint{BaseURL: "http://127.0.0.1:1"}, Request{})
	if !errors.Is(err, ErrModelFailed) {
		t.Fatalf("Complete() error = %v", err)
	}
}

func TestStripThinking(t *testing.T) {
	t.Parallel()
	for input, want := range map[string]string{
		" {}":                  "{}",
		"<think>a</think>\n{}": "{}",
		"<think>never closed":  "",
		"{\"t\":\"<think>\"}":  "{\"t\":\"<think>\"}",
	} {
		if got := StripThinking(input); got != want {
			t.Fatalf("StripThinking(%q) = %q, want %q", input, got, want)
		}
	}
}
