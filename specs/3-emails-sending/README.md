Status: IN_PROGRESS
Authors: @psankar
Dependencies: 1-project-scaffolding

## Acceptance Criteria

- api-server sends emails asynchronously via a database-backed queue
- Email delivery survives process crashes, restarts, and SIGKILL
- Each regional api-server processes emails for users in its region
- Emails contain both plain text and HTML parts (RFC 2045, RFC 822)
- Each email type (forgot-password, welcome, etc.) has distinct templates per portal (Hub, Employer, Agency). We will start with only one email tfa for Admin portal. Valid users will be sent a numerical code of 6 digits in email after they sign in with their password successfully. Only after this, will the admin users be able to do any operations.
- Failed emails are retried with exponential backoff
- Development environment includes Mailpit for email testing

## Scope

### Architecture Decision: Regional Email Queues

Emails are stored and processed in **regional databases**, not global. Rationale:

- Email addresses are PII, must stay in regional databases
- Each api-server instance processes its own region's queue
- No cross-region coordination needed for email delivery
- Shared SMTP configuration across regions (same provider credentials)

### Transactional Outbox Pattern

Follows the [transactional outbox pattern](https://www.gmhafiz.com/blog/transactional-outbox-pattern/) used by Rails Active Job, Laravel Queues, and Django post_office:

1. Business logic writes email to `emails` table within the same database transaction
2. Background worker polls for pending emails using `FOR UPDATE SKIP LOCKED`
3. Worker sends email via SMTP
4. Worker marks email as sent (or failed with retry info)

This ensures:

- Email is never lost if process crashes between business logic and send
- At-least-once delivery guarantee
- No external message broker (Redis, RabbitMQ) required

### Database Changes

```dbml
enum regional.email_status {
    pending
    processing
    sent
    failed
    cancelled
}

enum regional.email_type {
    hub_welcome
    hub_forgot_password
    hub_password_changed
    hub_email_verification
    org_welcome
    org_forgot_password
    org_password_changed
    org_invite
    agency_welcome
    agency_forgot_password
    agency_password_changed
}

Table regional.emails {
    email_id uuid [primary key, not null]
    email_type regional.email_type [not null]
    recipient_address text [not null, note: 'Recipient email address']
    subject text [not null]
    text_body text [not null]
    html_body text [not null]
    status regional.email_status [not null, default: 'pending']
    attempts int [not null, default: 0]
    max_attempts int [not null, default: 5]
    last_error text [note: 'Error message from last failed attempt']
    next_attempt_at timestamp [not null, default: `now()`]
    created_at timestamp [not null, default: `now()`]
    sent_at timestamp

    indexes {
        (status, next_attempt_at) [note: 'For worker polling query']
    }
}
```

### Worker Polling Query

```sql
SELECT email_id, email_type, recipient_address, subject, text_body, html_body, attempts
FROM emails
WHERE status IN ('pending', 'failed')
  AND next_attempt_at <= NOW()
  AND attempts < max_attempts
ORDER BY next_attempt_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

`FOR UPDATE SKIP LOCKED` allows multiple worker goroutines to process emails concurrently without conflicts. Locked rows are skipped by other workers.

### Email Templates

Templates are **not reusable across portals**. Each email type has its own template with portal-specific:

- Branding (logo, colors)
- Tone and wording
- Footer links

Template structure in `internal/email/templates/`:

```
templates/
├── hub/
│   ├── welcome.go
│   ├── forgot_password.go
│   ├── password_changed.go
│   └── email_verification.go
├── org/
│   ├── welcome.go
│   ├── forgot_password.go
│   ├── password_changed.go
│   └── invite.go
└── agency/
    ├── welcome.go
    ├── forgot_password.go
    └── password_changed.go
```

Each template file defines:

- Subject line
- HTML body (using hermes or html/template)
- Plain text body

Example template interface:

```go
type Template interface {
    EmailType() EmailType
    Subject(data any) string
    HTMLBody(data any) (string, error)
    TextBody(data any) (string, error)
}
```

### Email Enqueueing

Handlers enqueue emails within their database transaction:

```go
func ForgotPassword(s *server.Server) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // ... validate request, generate token ...

        tx, _ := s.GetRegionalDB(region).BeginTx(ctx, nil)
        defer tx.Rollback()

        // Save password reset token
        queries.CreatePasswordResetToken(ctx, token)

        // Enqueue email in same transaction
        email := templates.HubForgotPassword(user.Email, resetLink)
        queries.EnqueueEmail(ctx, email)

        tx.Commit()
    }
}
```

### Background Worker

Each api-server runs a background goroutine that:

1. Polls `emails` table every 5 seconds
2. Claims batch of pending emails using `SKIP LOCKED`
3. Sends each email via SMTP
4. Updates status to `sent` or increments `attempts` and sets `next_attempt_at`

```go
func (w *EmailWorker) Run(ctx context.Context) {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return  // Graceful shutdown
        case <-ticker.C:
            w.processBatch(ctx)
        }
    }
}
```

### Retry Strategy

Exponential backoff with jitter:

| Attempt | Delay      |
| ------- | ---------- |
| 1       | immediate  |
| 2       | 1 minute   |
| 3       | 5 minutes  |
| 4       | 30 minutes |
| 5       | 2 hours    |

After 5 failed attempts, status becomes `failed` permanently. Operations team can manually retry or investigate.

```go
func nextAttemptDelay(attempts int) time.Duration {
    delays := []time.Duration{
        0,
        1 * time.Minute,
        5 * time.Minute,
        30 * time.Minute,
        2 * time.Hour,
    }
    if attempts >= len(delays) {
        return delays[len(delays)-1]
    }
    return delays[attempts]
}
```

### Graceful Shutdown

On SIGTERM/SIGINT:

1. Stop accepting new poll cycles
2. Wait for in-flight SMTP sends to complete (with timeout)
3. Uncommitted emails remain `pending` in database
4. On restart, worker resumes processing pending emails

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGTERM, syscall.SIGINT)
    defer cancel()

    worker := email.NewWorker(s)
    go worker.Run(ctx)

    // ... HTTP server ...

    <-ctx.Done()
    // Worker stops on ctx cancellation
}
```

### SIGKILL Recovery

If process receives SIGKILL (no graceful shutdown):

- Emails with `status = 'processing'` have uncommitted transactions
- PostgreSQL rolls back transaction on connection close
- Emails revert to previous state (`pending` or `failed`)
- Worker picks them up on restart

No emails are lost.

### Docker Compose Changes

Add Mailpit service:

```yaml
mailpit:
  image: axllent/mailpit:latest
  ports:
    - "8025:8025" # Web UI
    - "1025:1025" # SMTP
  environment:
    MP_SMTP_AUTH_ACCEPT_ANY: "true"
    MP_SMTP_AUTH_ALLOW_INSECURE: "true"
```

Add environment variables to api-server-\* services:

```yaml
SMTP_HOST: mailpit
SMTP_PORT: 1025
SMTP_FROM_ADDRESS: noreply@vetchium.com
SMTP_FROM_NAME: Vetchium
EMAIL_WORKER_ENABLED: "true"
EMAIL_WORKER_BATCH_SIZE: 10
EMAIL_WORKER_POLL_INTERVAL: 5s
```

### Server Integration

Add to `server.Server`:

```go
type Server struct {
    Global       *globaldb.Queries
    RegionalIND1 *regionaldb.Queries
    RegionalUSA1 *regionaldb.Queries
    RegionalDEU1 *regionaldb.Queries
    Log          *slog.Logger
    SMTPConfig   *email.SMTPConfig
}
```

Worker initialization in `cmd/api-server.go`:

```go
smtpConfig := &email.SMTPConfig{
    Host:        os.Getenv("SMTP_HOST"),
    Port:        os.Getenv("SMTP_PORT"),
    FromAddress: os.Getenv("SMTP_FROM_ADDRESS"),
    FromName:    os.Getenv("SMTP_FROM_NAME"),
}

if os.Getenv("EMAIL_WORKER_ENABLED") == "true" {
    worker := email.NewWorker(s.GetRegionalDB(region), smtpConfig, s.Log)
    go worker.Run(ctx)
}
```

### SMTP Client

Use `net/smtp` with proper MIME multipart encoding:

```go
func (c *SMTPClient) Send(ctx context.Context, email *Email) error {
    msg := buildMIMEMessage(email)
    return smtp.SendMail(
        c.config.Host+":"+c.config.Port,
        nil,  // No auth in dev
        c.config.FromAddress,
        []string{email.RecipientAddress},
        msg,
    )
}

func buildMIMEMessage(email *Email) []byte {
    // Build multipart/alternative message per RFC 2046
    // with text/plain and text/html parts
}
```

### RFC Compliance

- RFC 822: Message format (headers, body structure)
- RFC 2045: MIME encoding (Content-Type, Content-Transfer-Encoding)
- RFC 2046: multipart/alternative for HTML + plain text

### No External Pub/Sub Required

PostgreSQL with `FOR UPDATE SKIP LOCKED` provides:

- Reliable job queue without Redis/RabbitMQ
- Concurrent worker support
- Automatic retry on crash
- Simpler operations (fewer moving parts)

This pattern scales to millions of emails/day per region before needing dedicated queue infrastructure.

### Development Workflow

1. `docker compose up` starts all services including Mailpit
2. Trigger an email-generating action (forgot password, signup, etc.)
3. Email is written to regional `emails` table
4. Worker picks up email, sends to Mailpit
5. View email at http://localhost:8025

### Production Considerations (Out of Scope)

- SMTP authentication (username/password or API key)
- TLS/SSL for SMTP connections
- Dedicated email providers (SendGrid, SES, Postmark)
- Email delivery monitoring and analytics
- Bounce handling and unsubscribe management

### API Changes

No public API endpoints for email. Email sending is triggered internally by other handlers.

```typespec
// No API changes - emails are internal
```
