// Package fake is a deterministic OpenAI-compatible chat completions server
// for CI. Markers in the last user message choose a failure, so tests can
// reach every outcome a real model server can produce:
//
//	[ai-dev:fail]      answers 500
//	[ai-dev:slow]      answers only after the caller gives up
//	[ai-dev:no-usage]  answers without token usage
//	[ai-dev:invalid]   answers text that is not JSON
//	[ai-dev:partial]   answers a valid title and an invalid positions count
//
// Otherwise it drafts an Opening from the request. Token counts are a quarter
// of the characters, rounded up, so tests can predict charges.
package fake

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// SlowDelay outlasts every configured request timeout.
const SlowDelay = 30 * time.Second

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type request struct {
	Model     string    `json:"model"`
	Messages  []message `json:"messages"`
	MaxTokens int       `json:"max_tokens"`
}

func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /", complete)
	return mux
}

func tokens(text string) int {
	return (utf8.RuneCountInString(text) + 3) / 4
}

func complete(w http.ResponseWriter, r *http.Request) {
	if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
		http.NotFound(w, r)
		return
	}
	var body request
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
		len(body.Messages) == 0 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	prompt := ""
	last := ""
	for _, m := range body.Messages {
		prompt += m.Content
		if m.Role == "user" {
			last = m.Content
		}
	}
	instruction := last
	if _, after, found := strings.Cut(last, "Request:\n"); found {
		instruction = after
	}
	switch {
	case strings.Contains(instruction, "[ai-dev:fail]"):
		http.Error(w, "model failed", http.StatusInternalServerError)
		return
	case strings.Contains(instruction, "[ai-dev:slow]"):
		select {
		case <-r.Context().Done():
		case <-time.After(SlowDelay):
		}
		return
	}
	content := draft(body.Model, instruction)
	switch {
	case strings.Contains(instruction, "[ai-dev:invalid]"):
		content = "I cannot answer in JSON."
	case strings.Contains(instruction, "[ai-dev:partial]"):
		content = `{"title":"Partial draft","positions":99}`
	}
	response := map[string]any{
		"object": "chat.completion",
		"model":  body.Model,
		"choices": []map[string]any{{
			"index":         0,
			"finish_reason": "stop",
			"message":       map[string]string{"role": "assistant", "content": content},
		}},
	}
	if !strings.Contains(instruction, "[ai-dev:no-usage]") {
		response["usage"] = map[string]int{
			"prompt_tokens":     tokens(prompt),
			"completion_tokens": tokens(content),
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func draft(model, instruction string) string {
	title := strings.TrimSpace(instruction)
	if utf8.RuneCountInString(title) > 60 {
		title = string([]rune(title)[:60])
	}
	encoded, _ := json.Marshal(map[string]any{
		"title":            "Draft: " + title,
		"description":      fmt.Sprintf("## About the role\n\n%s", strings.TrimSpace(instruction)),
		"work_arrangement": "hybrid",
		"employment_type":  "full_time",
		"positions":        1,
		"location_details": "Drafted by " + model,
	})
	return string(encoded)
}
