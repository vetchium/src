package email

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// WorkerConfig holds email worker configuration
type WorkerConfig struct {
	BatchSize    int32
	PollInterval time.Duration
	MaxAttempts  int
	RetryDelays  []time.Duration
}

// WorkerConfigFromEnv creates a WorkerConfig from environment variables
func WorkerConfigFromEnv() *WorkerConfig {
	batchSize, _ := strconv.Atoi(os.Getenv("EMAIL_WORKER_BATCH_SIZE"))
	if batchSize == 0 {
		batchSize = 10
	}

	pollInterval, _ := time.ParseDuration(os.Getenv("EMAIL_WORKER_POLL_INTERVAL"))
	if pollInterval == 0 {
		pollInterval = 30 * time.Second
	}

	maxAttempts, _ := strconv.Atoi(os.Getenv("EMAIL_WORKER_MAX_ATTEMPTS"))
	if maxAttempts == 0 {
		maxAttempts = 5
	}

	return &WorkerConfig{
		BatchSize:    int32(batchSize),
		PollInterval: pollInterval,
		MaxAttempts:  maxAttempts,
		RetryDelays: []time.Duration{
			0,                // Attempt 1: immediate
			1 * time.Minute,  // Attempt 2: 1 minute
			5 * time.Minute,  // Attempt 3: 5 minutes
			30 * time.Minute, // Attempt 4: 30 minutes
			2 * time.Hour,    // Attempt 5: 2 hours
		},
	}
}

// Worker processes the email queue
type Worker struct {
	queries    *regionaldb.Queries
	sender     *Sender
	config     *WorkerConfig
	log        *slog.Logger
	regionName string
}

// NewWorker creates a new email worker
func NewWorker(
	queries *regionaldb.Queries,
	sender *Sender,
	config *WorkerConfig,
	log *slog.Logger,
	regionName string,
) *Worker {
	return &Worker{
		queries:    queries,
		sender:     sender,
		config:     config,
		log:        log.With("component", "email-worker", "region", regionName),
		regionName: regionName,
	}
}

// Run starts the email worker. It blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	w.log.Info("starting email worker",
		"poll_interval", w.config.PollInterval,
		"batch_size", w.config.BatchSize,
		"max_attempts", w.config.MaxAttempts,
	)

	ticker := time.NewTicker(w.config.PollInterval)
	defer ticker.Stop()

	// Process immediately on start
	w.processBatch(ctx)

	for {
		select {
		case <-ctx.Done():
			w.log.Info("email worker stopping")
			return
		case <-ticker.C:
			w.processBatch(ctx)
		}
	}
}

func (w *Worker) processBatch(ctx context.Context) {
	emails, err := w.queries.GetEmailsToSend(ctx, w.config.BatchSize)
	if err != nil {
		w.log.Error("failed to fetch pending emails", "error", err)
		return
	}

	if len(emails) == 0 {
		return
	}

	w.log.Debug("processing email batch", "count", len(emails))

	for _, email := range emails {
		if ctx.Err() != nil {
			return // Context cancelled, stop processing
		}

		// Check if email should be retried based on backoff timing
		if !w.shouldRetry(email) {
			continue
		}

		w.processEmail(ctx, email)
	}
}

func (w *Worker) shouldRetry(email regionaldb.GetEmailsToSendRow) bool {
	attemptCount := int(email.AttemptCount)

	// First attempt (no previous attempts)
	if attemptCount == 0 {
		return true
	}

	// Max attempts reached
	if attemptCount >= w.config.MaxAttempts {
		return false
	}

	// Check backoff timing
	if !email.LastAttemptAt.Valid {
		return true // No last attempt recorded, retry
	}

	delay := w.getRetryDelay(attemptCount)
	nextRetryTime := email.LastAttemptAt.Time.Add(delay)

	return time.Now().After(nextRetryTime)
}

func (w *Worker) getRetryDelay(attemptCount int) time.Duration {
	if attemptCount >= len(w.config.RetryDelays) {
		return w.config.RetryDelays[len(w.config.RetryDelays)-1]
	}
	return w.config.RetryDelays[attemptCount]
}

func (w *Worker) processEmail(ctx context.Context, email regionaldb.GetEmailsToSendRow) {
	log := w.log.With(
		"email_id", email.EmailID.Bytes,
		"email_to", email.EmailTo,
		"email_type", email.EmailType,
		"attempt", email.AttemptCount+1,
	)

	log.Debug("sending email")

	// Send the email
	msg := &Message{
		To:       email.EmailTo,
		Subject:  email.EmailSubject,
		TextBody: email.EmailTextBody,
		HTMLBody: email.EmailHtmlBody,
	}

	err := w.sender.Send(msg)

	// Record the delivery attempt
	var errorMsg pgtype.Text
	if err != nil {
		errorMsg = pgtype.Text{String: err.Error(), Valid: true}
	}

	_, recordErr := w.queries.RecordDeliveryAttempt(ctx, regionaldb.RecordDeliveryAttemptParams{
		EmailID:      email.EmailID,
		ErrorMessage: errorMsg,
	})
	if recordErr != nil {
		log.Error("failed to record delivery attempt", "error", recordErr)
	}

	if err != nil {
		log.Warn("email send failed", "error", err)

		// Check if max attempts reached
		newAttemptCount := int(email.AttemptCount) + 1
		if newAttemptCount >= w.config.MaxAttempts {
			log.Error("email permanently failed after max attempts")
			if markErr := w.queries.MarkEmailAsFailed(ctx, email.EmailID); markErr != nil {
				log.Error("failed to mark email as failed", "error", markErr)
			}
		}
		// If not max attempts, email stays pending for retry
		return
	}

	// Success
	log.Info("email sent successfully")
	if markErr := w.queries.MarkEmailAsSent(ctx, email.EmailID); markErr != nil {
		log.Error("failed to mark email as sent", "error", markErr)
	}
}
