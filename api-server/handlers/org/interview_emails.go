package org

import (
	"context"
	"fmt"

	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// interviewEmailDetails carries the human-facing interview information rendered
// into notification emails sent to candidates and interviewers.
type interviewEmailDetails struct {
	InterviewType string
	StartsAt      string
	EndsAt        string
}

// interviewEmailContent returns the subject, plain-text body and HTML body for a
// given interview notification template. Keeping all interview email copy in one
// place avoids drift between the schedule/update/cancel/add/remove code paths.
func interviewEmailContent(emailType regionaldb.EmailTemplateType, d interviewEmailDetails) (subject, text, html string) {
	switch emailType {
	case regionaldb.EmailTemplateTypeHubInterviewScheduled:
		subject = "Interview scheduled"
		text = fmt.Sprintf("An interview has been scheduled: %s %s - %s", d.InterviewType, d.StartsAt, d.EndsAt)
		html = fmt.Sprintf("<p>An interview has been scheduled.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", d.InterviewType, d.StartsAt, d.EndsAt)
	case regionaldb.EmailTemplateTypeHubInterviewUpdated:
		subject = "Interview rescheduled"
		text = fmt.Sprintf("Your interview has been rescheduled: %s %s - %s", d.InterviewType, d.StartsAt, d.EndsAt)
		html = fmt.Sprintf("<p>Your interview has been rescheduled.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", d.InterviewType, d.StartsAt, d.EndsAt)
	case regionaldb.EmailTemplateTypeHubInterviewCancelled:
		subject = "Interview cancelled"
		text = fmt.Sprintf("Your interview has been cancelled: %s %s - %s", d.InterviewType, d.StartsAt, d.EndsAt)
		html = fmt.Sprintf("<p>Your interview has been cancelled.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", d.InterviewType, d.StartsAt, d.EndsAt)
	case regionaldb.EmailTemplateTypeOrgInterviewScheduledForInterviewer:
		subject = "You have been added to an interview panel"
		text = fmt.Sprintf("You have been added to an interview panel: %s %s - %s", d.InterviewType, d.StartsAt, d.EndsAt)
		html = fmt.Sprintf("<p>You have been added to an interview panel.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", d.InterviewType, d.StartsAt, d.EndsAt)
	case regionaldb.EmailTemplateTypeOrgInterviewUpdatedForInterviewer:
		subject = "Interview rescheduled"
		text = fmt.Sprintf("An interview on your panel has been rescheduled: %s %s - %s", d.InterviewType, d.StartsAt, d.EndsAt)
		html = fmt.Sprintf("<p>An interview on your panel has been rescheduled.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", d.InterviewType, d.StartsAt, d.EndsAt)
	case regionaldb.EmailTemplateTypeOrgInterviewCancelledForInterviewer:
		subject = "Interview cancelled"
		text = fmt.Sprintf("An interview on your panel has been cancelled: %s %s - %s", d.InterviewType, d.StartsAt, d.EndsAt)
		html = fmt.Sprintf("<p>An interview on your panel has been cancelled.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", d.InterviewType, d.StartsAt, d.EndsAt)
	case regionaldb.EmailTemplateTypeOrgInterviewerRemoved:
		subject = "You have been removed from an interview panel"
		text = fmt.Sprintf("You have been removed from an interview panel: %s %s - %s", d.InterviewType, d.StartsAt, d.EndsAt)
		html = fmt.Sprintf("<p>You have been removed from an interview panel.</p><p>Type: %s<br/>Start: %s<br/>End: %s</p>", d.InterviewType, d.StartsAt, d.EndsAt)
	}
	return subject, text, html
}

// enqueueInterviewEmail enqueues a single interview notification email inside the
// caller's transaction. Empty recipients are skipped. Enqueue failures are
// intentionally swallowed so a missing email row never rolls back the primary
// interview state change (the email queue is best-effort delivery).
func enqueueInterviewEmail(ctx context.Context, qtx *regionaldb.Queries, emailType regionaldb.EmailTemplateType, to string, d interviewEmailDetails) {
	if to == "" {
		return
	}
	subject, text, html := interviewEmailContent(emailType, d)
	_, _ = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     emailType,
		EmailTo:       to,
		EmailSubject:  subject,
		EmailTextBody: text,
		EmailHtmlBody: html,
	})
}

// enqueueInterviewerEmails fans an interview notification out to every listed
// recipient, used for reschedule/cancel events that affect the whole panel.
func enqueueInterviewerEmails(ctx context.Context, qtx *regionaldb.Queries, emailType regionaldb.EmailTemplateType, recipients []string, d interviewEmailDetails) {
	for _, to := range recipients {
		enqueueInterviewEmail(ctx, qtx, emailType, to, d)
	}
}
