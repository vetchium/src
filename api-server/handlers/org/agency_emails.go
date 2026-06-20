package org

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
)

// agencyEmailRecipient is a resolved notification target (an agency org user).
type agencyEmailRecipient struct {
	Name  string
	Email string
}

// agencyLeadRoleNames are the agency-side roles that should always be reachable
// for staffing notifications and coverage alerts.
var agencyLeadRoleNames = []string{"org:superadmin", "org:manage_agency_recruiters"}

// resolveAgencyRegion returns the home region of an agency org via the global
// routing table. Returns ("", false) when it cannot be resolved.
func resolveAgencyRegion(ctx context.Context, s *server.RegionalServer, agencyOrgID pgtype.UUID) (globaldb.Region, bool) {
	orgs, err := s.Global.GetOrgsByIDs(ctx, []pgtype.UUID{agencyOrgID})
	if err != nil || len(orgs) == 0 {
		return "", false
	}
	return globaldb.Region(orgs[0].Region), true
}

// clientDefaultRecipients returns the agency's default recruiters for a specific
// client domain, resolved against the agency's regional DB.
func clientDefaultRecipients(ctx context.Context, db *regionaldb.Queries, agencyOrgID pgtype.UUID, consumerDomain string) []agencyEmailRecipient {
	rows, err := db.ListClientDefaultRecruitersByAgency(ctx, agencyOrgID)
	if err != nil {
		return nil
	}
	var out []agencyEmailRecipient
	for _, row := range rows {
		if row.ConsumerOrgDomain == consumerDomain {
			out = append(out, agencyEmailRecipient{Name: row.FullName, Email: row.EmailAddress})
		}
	}
	return out
}

// agencyLeadRecipients returns the active agency leads (superadmins and agency
// recruiter managers) for an org, resolved against that org's regional DB.
func agencyLeadRecipients(ctx context.Context, db *regionaldb.Queries, orgID pgtype.UUID) []agencyEmailRecipient {
	var out []agencyEmailRecipient
	for _, roleName := range agencyLeadRoleNames {
		role, err := db.GetRoleByName(ctx, roleName)
		if err != nil {
			continue
		}
		rows, err := db.ListActiveOrgUserEmailsWithRole(ctx, regionaldb.ListActiveOrgUserEmailsWithRoleParams{
			OrgID:  orgID,
			RoleID: role.RoleID,
		})
		if err != nil {
			continue
		}
		for _, row := range rows {
			out = append(out, agencyEmailRecipient{Name: row.FullName, Email: row.EmailAddress})
		}
	}
	return out
}

// recipientsByID resolves a set of agency org user ids to notification recipients
// against the agency's regional DB.
func recipientsByID(ctx context.Context, db *regionaldb.Queries, ids []pgtype.UUID) []agencyEmailRecipient {
	if len(ids) == 0 {
		return nil
	}
	rows, err := db.GetOrgUsersByIDs(ctx, ids)
	if err != nil {
		return nil
	}
	var out []agencyEmailRecipient
	for _, row := range rows {
		if row.Status != "active" {
			continue
		}
		out = append(out, agencyEmailRecipient{Name: row.FullName.String, Email: row.EmailAddress})
	}
	return out
}

// enqueueAgencyEmails enqueues one notification per (deduped) recipient into the
// given region's email queue as best-effort standalone inserts. It is used for
// cross-region agency notifications that cannot ride the originating handler's
// transaction; delivery is best-effort, so enqueue failures are swallowed.
func enqueueAgencyEmails(
	ctx context.Context,
	s *server.RegionalServer,
	region globaldb.Region,
	emailType regionaldb.EmailTemplateType,
	recipients []agencyEmailRecipient,
	subject, text, html string,
) {
	db := s.GetRegionalDB(region)
	if db == nil {
		return
	}
	seen := map[string]bool{}
	for _, rcpt := range recipients {
		if rcpt.Email == "" || seen[rcpt.Email] {
			continue
		}
		seen[rcpt.Email] = true
		_, _ = db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
			EmailType:     emailType,
			EmailTo:       rcpt.Email,
			EmailSubject:  subject,
			EmailTextBody: text,
			EmailHtmlBody: html,
		})
	}
}

// alertUncoveredClients checks whether disabling an org user left any marketplace
// client without an active default recruiter, and if so emails the agency leads.
// All data lives in the agency's own (this handler's) region; it is best-effort
// so it never blocks the disable.
func alertUncoveredClients(ctx context.Context, s *server.RegionalServer, agencyOrgID, disabledUserID pgtype.UUID) {
	db := s.RegionalForCtx(ctx)
	domains, err := db.ListDefaultDomainsForRecruiter(ctx, regionaldb.ListDefaultDomainsForRecruiterParams{
		AgencyOrgID:     agencyOrgID,
		AgencyOrgUserID: disabledUserID,
	})
	if err != nil || len(domains) == 0 {
		return
	}

	var leads []agencyEmailRecipient
	for _, domain := range domains {
		cnt, cErr := db.CountActiveDefaultRecruitersForDomain(ctx, regionaldb.CountActiveDefaultRecruitersForDomainParams{
			AgencyOrgID:       agencyOrgID,
			ConsumerOrgDomain: domain,
		})
		if cErr != nil || cnt > 0 {
			continue // still covered by another active default recruiter
		}
		if leads == nil {
			leads = dedupeRecipients(agencyLeadRecipients(ctx, db, agencyOrgID))
		}
		subject, text, html := clientUncoveredEmail(s.UIConfig.OrgURL, domain)
		for _, rcpt := range leads {
			if rcpt.Email == "" {
				continue
			}
			_, _ = db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeOrgClientUncovered,
				EmailTo:       rcpt.Email,
				EmailSubject:  subject,
				EmailTextBody: text,
				EmailHtmlBody: html,
			})
		}
	}
}

// dedupeRecipients removes duplicate email addresses (a user holding both lead
// roles would otherwise appear twice).
func dedupeRecipients(in []agencyEmailRecipient) []agencyEmailRecipient {
	seen := map[string]bool{}
	out := make([]agencyEmailRecipient, 0, len(in))
	for _, r := range in {
		if r.Email == "" || seen[r.Email] {
			continue
		}
		seen[r.Email] = true
		out = append(out, r)
	}
	return out
}

// --- Email content builders (inline English, matching the existing notification
// email convention in interview_emails.go / applications.go). ---

func referralsLink(orgURL string) string {
	return strings.TrimRight(orgURL, "/") + "/referrals"
}

func referralOpeningLink(orgURL, openingID string) string {
	return strings.TrimRight(orgURL, "/") + "/referrals/openings/" + openingID
}

// agencyOpeningAssignedEmail notifies an agency that a client assigned it as a
// recruiting agency on an opening.
func agencyOpeningAssignedEmail(orgURL, consumerDomain, openingTitle string, openingNumber int32) (subject, text, html string) {
	role := openingTitle
	if role == "" {
		role = "an opening"
	}
	link := referralsLink(orgURL)
	subject = fmt.Sprintf("New opening assigned by %s", consumerDomain)
	text = fmt.Sprintf(
		"%s has assigned your agency as a recruiting agency on %s (#%d).\n\nReview it and assign recruiters here: %s",
		consumerDomain, role, openingNumber, link)
	html = fmt.Sprintf(
		"<p><strong>%s</strong> has assigned your agency as a recruiting agency on <strong>%s</strong> (#%d).</p><p><a href=\"%s\">Review it and assign recruiters</a></p>",
		html2(consumerDomain), html2(role), openingNumber, link)
	return subject, text, html
}

// recruiterAssignedEmail notifies an agency org user that they were assigned as a
// recruiter on an opening.
func recruiterAssignedEmail(orgURL, consumerDomain, openingTitle string, openingNumber int32, openingID string) (subject, text, html string) {
	role := openingTitle
	if role == "" {
		role = "an opening"
	}
	link := referralOpeningLink(orgURL, openingID)
	subject = fmt.Sprintf("You're assigned as recruiter for %s", role)
	text = fmt.Sprintf(
		"You have been assigned as a recruiter for %s (#%d) at %s.\n\nOpen it here: %s",
		role, openingNumber, consumerDomain, link)
	html = fmt.Sprintf(
		"<p>You have been assigned as a recruiter for <strong>%s</strong> (#%d) at <strong>%s</strong>.</p><p><a href=\"%s\">Open the opening</a></p>",
		html2(role), openingNumber, html2(consumerDomain), link)
	return subject, text, html
}

// referralCandidateAppliedEmail notifies the referring agency that a candidate it
// referred has applied to the opening through it.
func referralCandidateAppliedEmail(orgURL, candidateHandle, consumerDomain, openingTitle string, openingNumber int32, openingID string) (subject, text, html string) {
	role := openingTitle
	if role == "" {
		role = "an opening"
	}
	link := referralOpeningLink(orgURL, openingID)
	subject = fmt.Sprintf("Referred candidate @%s applied for %s", candidateHandle, role)
	text = fmt.Sprintf(
		"The candidate @%s you referred has applied for %s (#%d) at %s through your agency.\n\nView the referral here: %s",
		candidateHandle, role, openingNumber, consumerDomain, link)
	html = fmt.Sprintf(
		"<p>The candidate <strong>@%s</strong> you referred has applied for <strong>%s</strong> (#%d) at <strong>%s</strong> through your agency.</p><p><a href=\"%s\">View the referral</a></p>",
		html2(candidateHandle), html2(role), openingNumber, html2(consumerDomain), link)
	return subject, text, html
}

// clientUncoveredEmail alerts agency leads that a client has no active recruiter
// after an org user was disabled.
func clientUncoveredEmail(orgURL, consumerDomain string) (subject, text, html string) {
	link := referralsLink(orgURL)
	subject = fmt.Sprintf("Client %s has no active recruiter", consumerDomain)
	text = fmt.Sprintf(
		"The client %s no longer has any active recruiter assigned (the assigned recruiter's account was disabled). Referrals for this client cannot be actioned until a recruiter is assigned.\n\nAssign a recruiter here: %s",
		consumerDomain, link)
	html = fmt.Sprintf(
		"<p>The client <strong>%s</strong> no longer has any active recruiter assigned (the assigned recruiter's account was disabled). Referrals for this client cannot be actioned until a recruiter is assigned.</p><p><a href=\"%s\">Assign a recruiter</a></p>",
		html2(consumerDomain), link)
	return subject, text, html
}
