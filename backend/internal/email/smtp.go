package email

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/textproto"
	"strings"
	"time"

	"github.com/wneessen/go-mail/smtp"

	"backend/internal/appconfig"
)

type Sender interface {
	Send(context.Context, Message) error
}

type SMTPSender struct {
	config   appconfig.SMTP
	username string
	password string
}

func NewSMTPSender(config appconfig.SMTP) (*SMTPSender, error) {
	username, password, err := config.Credentials()
	if err != nil {
		return nil, err
	}
	return &SMTPSender{
		config: config, username: username, password: password,
	}, nil
}

func (s *SMTPSender) Send(ctx context.Context, message Message) error {
	contents, err := buildMIME(s.config, message)
	if err != nil {
		return err
	}
	address := net.JoinHostPort(s.config.Host, fmt.Sprint(s.config.Port))
	dialer := &net.Dialer{Timeout: s.config.ConnectionTimeout}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return fmt.Errorf("connect to SMTP server: %w", err)
	}
	defer func() { _ = connection.Close() }()
	deadline := time.Now().Add(s.config.ConnectionTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := connection.SetDeadline(deadline); err != nil {
		return fmt.Errorf("set SMTP deadline: %w", err)
	}
	client, err := smtp.NewClient(connection, s.config.Host)
	if err != nil {
		return fmt.Errorf("create SMTP client: %w", err)
	}
	defer func() { _ = client.Close() }()
	if err := s.startTLS(client); err != nil {
		return err
	}
	if s.username != "" {
		auth := smtp.PlainAuth(
			"", s.username, s.password, s.config.Host, false,
		)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("authenticate to SMTP server: %w", err)
		}
	}
	if err := client.Mail("<" + s.config.FromAddress + ">"); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt("<" + message.To + ">"); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	data, err := client.Data()
	if err != nil {
		return fmt.Errorf("start SMTP message: %w", err)
	}
	if _, err := data.Write(contents); err != nil {
		_ = data.Close()
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err := data.Close(); err != nil {
		return fmt.Errorf("finish SMTP message: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("quit SMTP session: %w", err)
	}
	return nil
}

func (s *SMTPSender) startTLS(client *smtp.Client) error {
	available, _ := client.Extension("STARTTLS")
	if !available {
		if s.config.StartTLS == appconfig.StartTLSRequired {
			return fmt.Errorf("SMTP server does not offer required STARTTLS")
		}
		return nil
	}
	if s.config.StartTLS == appconfig.StartTLSDisabled {
		return nil
	}
	err := client.StartTLS(&tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: s.config.Host,
	})
	if err != nil {
		return fmt.Errorf("start SMTP TLS: %w", err)
	}
	return nil
}

func buildMIME(config appconfig.SMTP, message Message) ([]byte, error) {
	for name, value := range map[string]string{
		"recipient":  message.To,
		"subject":    message.Subject,
		"message ID": message.MessageID,
	} {
		if value == "" || strings.ContainsAny(value, "\r\n") {
			return nil, fmt.Errorf("invalid email %s", name)
		}
	}
	if _, err := mail.ParseAddress(message.To); err != nil {
		return nil, fmt.Errorf("parse email recipient: %w", err)
	}
	parsedRecipient, _ := mail.ParseAddress(message.To)
	if parsedRecipient.Address != message.To {
		return nil, fmt.Errorf("email recipient must be a bare address")
	}
	if !validMessageID(message.MessageID) {
		return nil, fmt.Errorf("invalid email message ID")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	messageIDHash := sha256.Sum256([]byte(message.MessageID))
	boundary := "vetchium-" + hex.EncodeToString(messageIDHash[:8])
	if err := writer.SetBoundary(boundary); err != nil {
		return nil, fmt.Errorf("set MIME boundary: %w", err)
	}
	if err := writeAlternativePart(writer, "text/plain", message.TextBody); err != nil {
		return nil, err
	}
	if err := writeAlternativePart(writer, "text/html", message.HTMLBody); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("close MIME message: %w", err)
	}
	var result bytes.Buffer
	from := (&mail.Address{
		Name: config.FromName, Address: config.FromAddress,
	}).String()
	writeHeader(&result, "From", from)
	writeHeader(&result, "To", message.To)
	writeHeader(&result, "Subject", mime.QEncoding.Encode("utf-8", message.Subject))
	writeHeader(&result, "Date", time.Now().UTC().Format(time.RFC1123Z))
	writeHeader(&result, "Message-ID", "<"+message.MessageID+">")
	writeHeader(&result, "MIME-Version", "1.0")
	writeHeader(
		&result, "Content-Type",
		"multipart/alternative; boundary=\""+writer.Boundary()+"\"",
	)
	result.WriteString("\r\n")
	_, _ = io.Copy(&result, &body)
	return result.Bytes(), nil
}

func validMessageID(value string) bool {
	if strings.Count(value, "@") != 1 {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			strings.ContainsRune("@._-", character) {
			continue
		}
		return false
	}
	return true
}

func writeAlternativePart(
	writer *multipart.Writer, contentType, body string,
) error {
	header := make(textproto.MIMEHeader)
	header.Set("Content-Type", contentType+"; charset=utf-8")
	header.Set("Content-Transfer-Encoding", "quoted-printable")
	part, err := writer.CreatePart(header)
	if err != nil {
		return fmt.Errorf("create %s MIME part: %w", contentType, err)
	}
	encoded := quotedprintable.NewWriter(part)
	if _, err := encoded.Write([]byte(body)); err != nil {
		_ = encoded.Close()
		return fmt.Errorf("write %s MIME part: %w", contentType, err)
	}
	if err := encoded.Close(); err != nil {
		return fmt.Errorf("close %s MIME part: %w", contentType, err)
	}
	return nil
}

func writeHeader(buffer *bytes.Buffer, name, value string) {
	buffer.WriteString(name)
	buffer.WriteString(": ")
	buffer.WriteString(value)
	buffer.WriteString("\r\n")
}
