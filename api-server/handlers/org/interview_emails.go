package org

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// interviewEmailDetails carries the human-facing interview information rendered
// into notification emails sent to candidates and interviewers.
type interviewEmailDetails struct {
	InterviewType string
	StartsAt      string // display string (RFC3339)
	EndsAt        string // display string (RFC3339)
	Location      string // optional address / video link
	CandidacyID   string // used to build a deep link in the email body
}

// interviewICS holds the fields needed to render an RFC 5545 VEVENT so the
// recipient can add (or remove) the interview from their calendar.
type interviewICS struct {
	UID      string
	Summary  string
	Desc     string
	Location string
	Start    time.Time
	End      time.Time
	Method   string // REQUEST (schedule/update/add) or CANCEL (cancel/remove)
	Status   string // CONFIRMED or CANCELLED
	Sequence int
}

// buildInterviewICS renders the calendar invite for a single recipient. The
// recipient address becomes the ATTENDEE so calendar clients RSVP correctly.
func buildInterviewICS(ev interviewICS, attendee string) string {
	const stamp = "20060102T150405Z"
	esc := func(s string) string {
		s = strings.ReplaceAll(s, "\\", "\\\\")
		s = strings.ReplaceAll(s, ";", "\\;")
		s = strings.ReplaceAll(s, ",", "\\,")
		s = strings.ReplaceAll(s, "\n", "\\n")
		return s
	}
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\n")
	b.WriteString("VERSION:2.0\r\n")
	b.WriteString("PRODID:-//Vetchium//Hiring//EN\r\n")
	b.WriteString("CALSCALE:GREGORIAN\r\n")
	b.WriteString("METHOD:" + ev.Method + "\r\n")
	b.WriteString("BEGIN:VEVENT\r\n")
	b.WriteString("UID:" + ev.UID + "@vetchium\r\n")
	b.WriteString("DTSTAMP:" + time.Now().UTC().Format(stamp) + "\r\n")
	b.WriteString("DTSTART:" + ev.Start.UTC().Format(stamp) + "\r\n")
	b.WriteString("DTEND:" + ev.End.UTC().Format(stamp) + "\r\n")
	b.WriteString("SUMMARY:" + esc(ev.Summary) + "\r\n")
	if ev.Desc != "" {
		b.WriteString("DESCRIPTION:" + esc(ev.Desc) + "\r\n")
	}
	if ev.Location != "" {
		b.WriteString("LOCATION:" + esc(ev.Location) + "\r\n")
	}
	b.WriteString("ORGANIZER;CN=Vetchium:mailto:noreply@vetchium.com\r\n")
	if attendee != "" {
		b.WriteString("ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:" + attendee + "\r\n")
	}
	b.WriteString(fmt.Sprintf("SEQUENCE:%d\r\n", ev.Sequence))
	b.WriteString("STATUS:" + ev.Status + "\r\n")
	b.WriteString("END:VEVENT\r\n")
	b.WriteString("END:VCALENDAR\r\n")
	return b.String()
}

// interviewEmailContent returns the subject, plain-text body and HTML body for a
// given interview notification template. Keeping all interview email copy in one
// place avoids drift between the schedule/update/cancel/add/remove code paths.
func interviewEmailContent(emailType regionaldb.EmailTemplateType, d interviewEmailDetails) (subject, text, html string) {
	// Build the optional location and deep-link lines shared by all templates.
	loc := ""
	locHTML := ""
	if d.Location != "" {
		loc = fmt.Sprintf("\nLocation / link: %s", d.Location)
		locHTML = fmt.Sprintf("<br/>Location / link: %s", d.Location)
	}
	link := ""
	linkHTML := ""
	if d.CandidacyID != "" {
		// Org-side templates link to the org candidacy view; hub templates to the
		// candidate's own candidacy view.
		path := "/candidacies/" + d.CandidacyID
		if strings.HasPrefix(string(emailType), "hub_") {
			path = "/my-candidacies/" + d.CandidacyID
		}
		link = fmt.Sprintf("\nDetails: %s", path)
		linkHTML = fmt.Sprintf(`<br/>Details: <a href="%s">%s</a>`, path, path)
	}

	body := func(lead string) (string, string) {
		t := fmt.Sprintf("%s\nType: %s\nStart: %s\nEnd: %s%s%s\n\nA calendar invite (.ics) is attached.",
			lead, d.InterviewType, d.StartsAt, d.EndsAt, loc, link)
		h := fmt.Sprintf("<p>%s</p><p>Type: %s<br/>Start: %s<br/>End: %s%s%s</p><p>A calendar invite (.ics) is attached.</p>",
			lead, d.InterviewType, d.StartsAt, d.EndsAt, locHTML, linkHTML)
		return t, h
	}

	switch emailType {
	case regionaldb.EmailTemplateTypeHubInterviewScheduled:
		subject = "Interview scheduled"
		text, html = body("An interview has been scheduled.")
	case regionaldb.EmailTemplateTypeHubInterviewUpdated:
		subject = "Interview rescheduled"
		text, html = body("Your interview has been rescheduled.")
	case regionaldb.EmailTemplateTypeHubInterviewCancelled:
		subject = "Interview cancelled"
		text, html = body("Your interview has been cancelled.")
	case regionaldb.EmailTemplateTypeOrgInterviewScheduledForInterviewer:
		subject = "You have been added to an interview panel"
		text, html = body("You have been added to an interview panel.")
	case regionaldb.EmailTemplateTypeOrgInterviewUpdatedForInterviewer:
		subject = "Interview rescheduled"
		text, html = body("An interview on your panel has been rescheduled.")
	case regionaldb.EmailTemplateTypeOrgInterviewCancelledForInterviewer:
		subject = "Interview cancelled"
		text, html = body("An interview on your panel has been cancelled.")
	case regionaldb.EmailTemplateTypeOrgInterviewerRemoved:
		subject = "You have been removed from an interview panel"
		text, html = body("You have been removed from an interview panel.")
	}
	return subject, text, html
}

// enqueueInterviewEmail enqueues a single interview notification email inside the
// caller's transaction. Empty recipients are skipped. When ev is non-nil a
// per-recipient .ics invite is attached. Enqueue failures are intentionally
// swallowed so a missing email row never rolls back the primary interview state
// change (the email queue is best-effort delivery).
func enqueueInterviewEmail(ctx context.Context, qtx *regionaldb.Queries, emailType regionaldb.EmailTemplateType, to string, d interviewEmailDetails, ev *interviewICS) {
	if to == "" {
		return
	}
	subject, text, html := interviewEmailContent(emailType, d)
	var ical pgtype.Text
	if ev != nil {
		ical = pgtype.Text{String: buildInterviewICS(*ev, to), Valid: true}
	}
	_, _ = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     emailType,
		EmailTo:       to,
		EmailSubject:  subject,
		EmailTextBody: text,
		EmailHtmlBody: html,
		EmailIcal:     ical,
	})
}

// enqueueInterviewerEmails fans an interview notification out to every listed
// recipient, used for reschedule/cancel events that affect the whole panel.
func enqueueInterviewerEmails(ctx context.Context, qtx *regionaldb.Queries, emailType regionaldb.EmailTemplateType, recipients []string, d interviewEmailDetails, ev *interviewICS) {
	for _, to := range recipients {
		enqueueInterviewEmail(ctx, qtx, emailType, to, d, ev)
	}
}
