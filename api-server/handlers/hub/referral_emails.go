package hub

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
)

// emailEscape minimally escapes a string for safe inclusion in an HTML email body.
func emailEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

// notifyReferringAgency enqueues a best-effort notification to the agency org
// user who referred the candidate, telling them the candidate has applied
// through their agency. The agency user lives in the agency's home region (which
// may differ from the opening's region), so the email is enqueued as a standalone
// insert into that region's queue; failures are swallowed.
func notifyReferringAgency(
	ctx context.Context,
	s *server.RegionalServer,
	referral *regionaldb.AgencyReferral,
	openingTitle string,
	openingNumber int32,
	openingID string,
	consumerDomain string,
	candidateHandle string,
) {
	agencyOrgs, err := s.Global.GetOrgsByIDs(ctx, []pgtype.UUID{referral.AgencyOrgID})
	if err != nil || len(agencyOrgs) == 0 {
		return
	}
	agencyDB := s.GetRegionalDB(globaldb.Region(agencyOrgs[0].Region))
	if agencyDB == nil {
		return
	}
	users, err := agencyDB.GetOrgUsersByIDs(ctx, []pgtype.UUID{referral.ReferredByOrgUserID})
	if err != nil {
		return
	}

	role := openingTitle
	if role == "" {
		role = "an opening"
	}
	link := strings.TrimRight(s.UIConfig.OrgURL, "/") + "/referrals/openings/" + openingID
	subject := fmt.Sprintf("Referred candidate @%s applied for %s", candidateHandle, role)
	text := fmt.Sprintf(
		"The candidate @%s you referred has applied for %s (#%d) at %s through your agency.\n\nView the referral here: %s",
		candidateHandle, role, openingNumber, consumerDomain, link)
	html := fmt.Sprintf(
		"<p>The candidate <strong>@%s</strong> you referred has applied for <strong>%s</strong> (#%d) at <strong>%s</strong> through your agency.</p><p><a href=\"%s\">View the referral</a></p>",
		emailEscape(candidateHandle), emailEscape(role), openingNumber, emailEscape(consumerDomain), link)

	for _, u := range users {
		if u.Status != "active" || u.EmailAddress == "" {
			continue
		}
		_, _ = agencyDB.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
			EmailType:     regionaldb.EmailTemplateTypeOrgReferralCandidateApplied,
			EmailTo:       u.EmailAddress,
			EmailSubject:  subject,
			EmailTextBody: text,
			EmailHtmlBody: html,
		})
	}
}
