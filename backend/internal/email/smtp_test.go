package email

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"testing"

	"backend/internal/appconfig"
)

func TestBuildMIMEProducesTextAndHTMLAlternatives(t *testing.T) {
	contents, err := buildMIME(appconfig.SMTP{
		FromAddress: "no-reply@vetchium.example",
		FromName:    "Vetchium",
	}, Message{
		To:        "ada@example.com",
		Subject:   "வணக்கம் Ada",
		TextBody:  "Plain body",
		HTMLBody:  "<p>HTML body</p>",
		MessageID: "hub-123@sgp.vetchium",
	})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := mail.ReadMessage(bytes.NewReader(contents))
	if err != nil {
		t.Fatal(err)
	}
	mediaType, parameters, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	if mediaType != "multipart/alternative" {
		t.Fatalf("media type = %q", mediaType)
	}
	reader := multipart.NewReader(parsed.Body, parameters["boundary"])
	wants := []string{"Plain body", "<p>HTML body</p>"}
	for _, want := range wants {
		part, partErr := reader.NextPart()
		if partErr != nil {
			t.Fatal(partErr)
		}
		decoded, readErr := io.ReadAll(quotedprintable.NewReader(part))
		if readErr != nil {
			t.Fatal(readErr)
		}
		if !strings.Contains(string(decoded), want) {
			t.Errorf("part = %q, want %q", decoded, want)
		}
	}
}

func TestBuildMIMERejectsHeaderInjectionAndDisplayRecipient(t *testing.T) {
	config := appconfig.SMTP{
		FromAddress: "no-reply@vetchium.example",
		FromName:    "Vetchium",
	}
	valid := Message{
		To:        "ada@example.com",
		Subject:   "Subject",
		TextBody:  "text",
		HTMLBody:  "html",
		MessageID: "hub-123@sgp.vetchium",
	}
	for name, mutate := range map[string]func(*Message){
		"recipient newline": func(message *Message) { message.To += "\r\nBcc: victim@example.com" },
		"subject newline":   func(message *Message) { message.Subject += "\nBcc: victim@example.com" },
		"message ID syntax": func(message *Message) { message.MessageID = "<bad>@example.com" },
		"display recipient": func(message *Message) { message.To = "Ada <ada@example.com>" },
	} {
		t.Run(name, func(t *testing.T) {
			message := valid
			mutate(&message)
			if _, err := buildMIME(config, message); err == nil {
				t.Fatal("invalid message was accepted")
			}
		})
	}
}
