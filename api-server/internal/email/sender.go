package email

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/smtp"
	"net/textproto"
	"path/filepath"
	"strings"
	"time"
)

// Attachment represents an email attachment
type Attachment struct {
	Filename    string
	ContentType string // e.g., "application/pdf"
	Data        []byte
}

// Message represents an email message ready to be sent
type Message struct {
	To          string
	Subject     string
	TextBody    string
	HTMLBody    string
	Attachments []Attachment
}

// Sender handles sending emails via SMTP
type Sender struct {
	config *SMTPConfig
}

// NewSender creates a new email sender
func NewSender(config *SMTPConfig) *Sender {
	return &Sender{config: config}
}

// Send sends an email message via SMTP
func (s *Sender) Send(msg *Message) error {
	mimeMsg, err := buildMIMEMessage(s.config, msg)
	if err != nil {
		return fmt.Errorf("building MIME message: %w", err)
	}

	addr := fmt.Sprintf("%s:%d", s.config.Host, s.config.Port)

	// Use PLAIN auth if credentials are provided
	var auth smtp.Auth
	if s.config.Username != "" && s.config.Password != "" {
		auth = smtp.PlainAuth("", s.config.Username, s.config.Password, s.config.Host)
	}

	err = smtp.SendMail(
		addr,
		auth,
		s.config.FromAddress,
		[]string{msg.To},
		mimeMsg,
	)
	if err != nil {
		return fmt.Errorf("sending email: %w", err)
	}

	return nil
}

// buildMIMEMessage creates a MIME message per RFC 2045/2046
// - Without attachments: multipart/alternative (text + html)
// - With attachments: multipart/mixed containing multipart/alternative + attachments
func buildMIMEMessage(config *SMTPConfig, msg *Message) ([]byte, error) {
	var buf bytes.Buffer

	// Write common headers (RFC 822)
	writeHeader(&buf, "From", formatAddress(config.FromName, config.FromAddress))
	writeHeader(&buf, "To", msg.To)
	writeHeader(&buf, "Subject", encodeSubject(msg.Subject))
	writeHeader(&buf, "Date", time.Now().Format(time.RFC1123Z))
	writeHeader(&buf, "MIME-Version", "1.0")

	if len(msg.Attachments) == 0 {
		// Simple case: multipart/alternative for text + html
		return buildAlternativeMessage(&buf, msg)
	}

	// Complex case: multipart/mixed with alternative body + attachments
	return buildMixedMessage(&buf, msg)
}

func buildAlternativeMessage(buf *bytes.Buffer, msg *Message) ([]byte, error) {
	boundary := fmt.Sprintf("=_%d_alt_=", time.Now().UnixNano())
	writeHeader(buf, "Content-Type", fmt.Sprintf("multipart/alternative; boundary=\"%s\"", boundary))
	buf.WriteString("\r\n")

	mpWriter := multipart.NewWriter(buf)
	mpWriter.SetBoundary(boundary)

	if err := writeBodyParts(mpWriter, msg); err != nil {
		return nil, err
	}

	mpWriter.Close()
	return buf.Bytes(), nil
}

func buildMixedMessage(buf *bytes.Buffer, msg *Message) ([]byte, error) {
	mixedBoundary := fmt.Sprintf("=_%d_mixed_=", time.Now().UnixNano())
	writeHeader(buf, "Content-Type", fmt.Sprintf("multipart/mixed; boundary=\"%s\"", mixedBoundary))
	buf.WriteString("\r\n")

	mixedWriter := multipart.NewWriter(buf)
	mixedWriter.SetBoundary(mixedBoundary)

	// First part: multipart/alternative for body
	altBoundary := fmt.Sprintf("=_%d_alt_=", time.Now().UnixNano())
	altHeader := make(textproto.MIMEHeader)
	altHeader.Set("Content-Type", fmt.Sprintf("multipart/alternative; boundary=\"%s\"", altBoundary))
	altPart, err := mixedWriter.CreatePart(altHeader)
	if err != nil {
		return nil, fmt.Errorf("creating alternative part: %w", err)
	}

	altWriter := multipart.NewWriter(altPart)
	altWriter.SetBoundary(altBoundary)
	if err := writeBodyParts(altWriter, msg); err != nil {
		return nil, err
	}
	altWriter.Close()

	// Attachment parts
	for _, att := range msg.Attachments {
		attHeader := make(textproto.MIMEHeader)
		contentType := att.ContentType
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		attHeader.Set("Content-Type", contentType)
		attHeader.Set("Content-Transfer-Encoding", "base64")
		attHeader.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(att.Filename)))

		attPart, err := mixedWriter.CreatePart(attHeader)
		if err != nil {
			return nil, fmt.Errorf("creating attachment part: %w", err)
		}

		// Base64 encode with line breaks every 76 chars
		encoded := base64.StdEncoding.EncodeToString(att.Data)
		for i := 0; i < len(encoded); i += 76 {
			end := i + 76
			if end > len(encoded) {
				end = len(encoded)
			}
			attPart.Write([]byte(encoded[i:end] + "\r\n"))
		}
	}

	mixedWriter.Close()
	return buf.Bytes(), nil
}

func writeBodyParts(mpWriter *multipart.Writer, msg *Message) error {
	// Write text/plain part
	textHeader := make(textproto.MIMEHeader)
	textHeader.Set("Content-Type", "text/plain; charset=utf-8")
	textHeader.Set("Content-Transfer-Encoding", "quoted-printable")
	textPart, err := mpWriter.CreatePart(textHeader)
	if err != nil {
		return fmt.Errorf("creating text part: %w", err)
	}
	textPart.Write([]byte(encodeQuotedPrintable(msg.TextBody)))

	// Write text/html part
	htmlHeader := make(textproto.MIMEHeader)
	htmlHeader.Set("Content-Type", "text/html; charset=utf-8")
	htmlHeader.Set("Content-Transfer-Encoding", "quoted-printable")
	htmlPart, err := mpWriter.CreatePart(htmlHeader)
	if err != nil {
		return fmt.Errorf("creating html part: %w", err)
	}
	htmlPart.Write([]byte(encodeQuotedPrintable(msg.HTMLBody)))

	return nil
}

func writeHeader(buf *bytes.Buffer, key, value string) {
	buf.WriteString(key)
	buf.WriteString(": ")
	buf.WriteString(value)
	buf.WriteString("\r\n")
}

func formatAddress(name, email string) string {
	if name == "" {
		return email
	}
	// RFC 2047 encoded-word if name contains non-ASCII
	if needsEncoding(name) {
		return fmt.Sprintf("=?utf-8?b?%s?= <%s>", base64.StdEncoding.EncodeToString([]byte(name)), email)
	}
	return fmt.Sprintf("%s <%s>", name, email)
}

func encodeSubject(subject string) string {
	if needsEncoding(subject) {
		return "=?utf-8?b?" + base64.StdEncoding.EncodeToString([]byte(subject)) + "?="
	}
	return subject
}

func needsEncoding(s string) bool {
	for _, r := range s {
		if r > 127 {
			return true
		}
	}
	return false
}

// encodeQuotedPrintable encodes text as quoted-printable (RFC 2045)
func encodeQuotedPrintable(s string) string {
	var buf strings.Builder
	lineLen := 0

	for i := 0; i < len(s); i++ {
		c := s[i]

		// Handle line endings
		if c == '\n' {
			buf.WriteString("\r\n")
			lineLen = 0
			continue
		}
		if c == '\r' {
			continue // Skip CR, we add CRLF for LF
		}

		var encoded string
		if c == '=' || c < 32 || c > 126 {
			// Encode as =XX
			encoded = fmt.Sprintf("=%02X", c)
		} else {
			encoded = string(c)
		}

		// Soft line break at 76 characters
		if lineLen+len(encoded) > 75 {
			buf.WriteString("=\r\n")
			lineLen = 0
		}

		buf.WriteString(encoded)
		lineLen += len(encoded)
	}

	return buf.String()
}
