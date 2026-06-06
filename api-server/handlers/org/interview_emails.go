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
	CandidateName string    // candidate's display name (shown to interviewers)
	OpeningTitle  string    // the role being interviewed for
	InterviewType string    // in_person | video | take_home | other
	Start         time.Time // interview start (rendered in UTC)
	End           time.Time // interview end
	Location      string    // optional address / video link
	CandidacyID   string    // used to build the deep link
	OrgURL        string    // org-ui base URL (interviewer links)
	HubURL        string    // hub-ui base URL (candidate links)
}

// icsSummary builds the calendar event title from the interview context.
func icsSummary(d interviewEmailDetails) string {
	if d.OpeningTitle != "" {
		return "Interview: " + d.OpeningTitle
	}
	return "Interview"
}

func interviewTypeLabel(t string) string {
	switch t {
	case "in_person":
		return "In person"
	case "video":
		return "Video"
	case "take_home":
		return "Take-home"
	default:
		return "Other"
	}
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
	isHub := strings.HasPrefix(string(emailType), "hub_")
	role := d.OpeningTitle
	if role == "" {
		role = "the role"
	}

	// Human-readable time window in UTC. The attached .ics carries the precise,
	// timezone-aware event for the recipient's calendar.
	when := ""
	if !d.Start.IsZero() {
		when = d.Start.UTC().Format("Mon, 2 Jan 2006, 15:04") +
			"–" + d.End.UTC().Format("15:04") + " UTC"
	}

	// Deep link to the candidacy: candidate → hub portal, interviewer → org portal.
	url := ""
	if d.CandidacyID != "" {
		if isHub {
			url = strings.TrimRight(d.HubURL, "/") + "/my-candidacies/" + d.CandidacyID
		} else {
			url = strings.TrimRight(d.OrgURL, "/") + "/candidacies/" + d.CandidacyID
		}
	}

	// body assembles the shared detail block. linkLabel/lead differ per template.
	body := func(lead, linkLabel string) (string, string) {
		var tb strings.Builder
		var hb strings.Builder
		tb.WriteString(lead + "\n\n")
		hb.WriteString("<p>" + html2(lead) + "</p><table cellpadding=\"4\">")

		row := func(k, v string) {
			if v == "" {
				return
			}
			tb.WriteString(k + ": " + v + "\n")
			hb.WriteString("<tr><td><strong>" + html2(k) + "</strong></td><td>" + html2(v) + "</td></tr>")
		}
		row("Role", role)
		if !isHub {
			row("Candidate", d.CandidateName)
		}
		row("Type", interviewTypeLabel(d.InterviewType))
		row("When", when)
		row("Location / link", d.Location)
		hb.WriteString("</table>")

		if url != "" {
			tb.WriteString("\n" + linkLabel + ": " + url + "\n")
			hb.WriteString(fmt.Sprintf(`<p><a href="%s">%s</a></p>`, url, html2(linkLabel)))
		}
		tb.WriteString("\nA calendar invite (.ics) is attached so you can add it to your calendar.")
		hb.WriteString("<p>A calendar invite (.ics) is attached so you can add it to your calendar.</p>")
		return tb.String(), hb.String()
	}

	switch emailType {
	case regionaldb.EmailTemplateTypeHubInterviewScheduled:
		subject = fmt.Sprintf("Interview scheduled for %s", role)
		text, html = body(
			fmt.Sprintf("Your interview for %s has been scheduled.", role),
			"View your candidacy")
	case regionaldb.EmailTemplateTypeHubInterviewUpdated:
		subject = fmt.Sprintf("Interview rescheduled for %s", role)
		text, html = body(
			fmt.Sprintf("Your interview for %s has been rescheduled. The updated time is below.", role),
			"View your candidacy")
	case regionaldb.EmailTemplateTypeHubInterviewCancelled:
		subject = fmt.Sprintf("Interview cancelled for %s", role)
		text, html = body(
			fmt.Sprintf("Your interview for %s has been cancelled.", role),
			"View your candidacy")
	case regionaldb.EmailTemplateTypeOrgInterviewScheduledForInterviewer:
		subject = fmt.Sprintf("You're interviewing %s (%s)", d.CandidateName, role)
		text, html = body(
			fmt.Sprintf("You've been added to the interview panel for %s.", d.CandidateName),
			"Open the candidacy")
	case regionaldb.EmailTemplateTypeOrgInterviewUpdatedForInterviewer:
		subject = fmt.Sprintf("Interview rescheduled: %s (%s)", d.CandidateName, role)
		text, html = body(
			fmt.Sprintf("An interview on your panel for %s has been rescheduled. The updated time is below.", d.CandidateName),
			"Open the candidacy")
	case regionaldb.EmailTemplateTypeOrgInterviewCancelledForInterviewer:
		subject = fmt.Sprintf("Interview cancelled: %s (%s)", d.CandidateName, role)
		text, html = body(
			fmt.Sprintf("An interview on your panel for %s has been cancelled.", d.CandidateName),
			"Open the candidacy")
	case regionaldb.EmailTemplateTypeOrgInterviewerRemoved:
		subject = fmt.Sprintf("Removed from interview panel: %s (%s)", d.CandidateName, role)
		text, html = body(
			fmt.Sprintf("You've been removed from the interview panel for %s.", d.CandidateName),
			"Open the candidacy")
	}
	return subject, text, html
}

// html2 minimally escapes a string for safe inclusion in the HTML email body.
func html2(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
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
