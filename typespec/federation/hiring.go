package federation

import (
	"strings"

	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"
)

// HubApplyKind is the command a Hub user's home tenant sends to the Org's
// tenant to apply to a published Opening. Its authority principal is the Org
// and its aggregate id is the Opening number as decimal text.
const HubApplyKind CommandKind = "hub-apply"

type HubApplyPayload struct {
	OpeningNumber openings.OpeningNumber             `json:"opening_number"`
	ApplicantDID  hub.HubUserDID                     `json:"applicant_did"`
	CoverNote     *applications.ApplicationCoverNote `json:"cover_note,omitempty"`
	Snapshot      profile.ApplicantSnapshot          `json:"snapshot"`
}

// Normalize trims the cover note, drops a blank one, and makes the
// snapshot's required arrays empty rather than nil. It assigns new values and
// never mutates storage the caller shares.
func (p *HubApplyPayload) Normalize() {
	if p.CoverNote != nil {
		trimmed := applications.ApplicationCoverNote(
			strings.TrimSpace(string(*p.CoverNote)),
		)
		if trimmed == "" {
			p.CoverNote = nil
		} else {
			p.CoverNote = &trimmed
		}
	}
	p.Snapshot = p.Snapshot.Normalized()
}

func (p HubApplyPayload) Validate() []string {
	fields := []string{}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !hub.IsHubUserDID(p.ApplicantDID) {
		fields = append(fields, "applicant_did")
	}
	if p.CoverNote != nil && !applications.IsApplicationCoverNote(*p.CoverNote) {
		fields = append(fields, "cover_note")
	}
	for _, field := range p.Snapshot.Validate() {
		fields = append(fields, "snapshot."+field)
	}
	return fields
}

// HubApplyResult is the stored `201` body of a successful hub-apply.
type HubApplyResult struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
}
