package applications

import (
	"testing"

	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/federation/commands"
)

// Only the rejections the Hub contract declares pass to the browser; an
// initiator mismatch or a malformed command is a fault between tenants.
func TestStoredRejectionsMapOnlyToDeclaredHubProblems(t *testing.T) {
	for _, tc := range []struct {
		name  string
		known map[string]problem.Details
		want  map[string]string
	}{
		{"apply", applyRejections, map[string]string{
			hubproblem.OpeningNotFoundError.Type:           hubproblem.OpeningNotFoundError.Type,
			hubproblem.OpeningNotAcceptingError.Type:       hubproblem.OpeningNotAcceptingError.Type,
			hubproblem.ApplicationExistsError.Type:         hubproblem.ApplicationExistsError.Type,
			hubproblem.ReferralAgencyNotEligibleError.Type: hubproblem.ReferralAgencyNotEligibleError.Type,
			federationproblem.AuthorityNotFoundError.Type:  hubproblem.OrgNotFoundError.Type,
		}},
		{"withdraw", withdrawRejections, map[string]string{
			hubproblem.ApplicationNotFoundError.Type:      hubproblem.ApplicationNotFoundError.Type,
			hubproblem.ApplicationStateConflictError.Type: hubproblem.ApplicationStateConflictError.Type,
			federationproblem.AuthorityNotFoundError.Type: hubproblem.ApplicationNotFoundError.Type,
		}},
	} {
		if len(tc.known) != len(tc.want) {
			t.Errorf("%s maps %d problems, want %d", tc.name, len(tc.known), len(tc.want))
		}
		for upstream, want := range tc.want {
			if got := tc.known[upstream].Type; got != want {
				t.Errorf("%s %q = %q, want %q", tc.name, upstream, got, want)
			}
		}
		for _, fault := range []string{
			federationproblem.InitiatorMismatchError.Type,
			problem.ValidationFailedError.Type,
		} {
			if _, ok := tc.known[fault]; ok {
				t.Errorf("%s passes %q to the browser", tc.name, fault)
			}
		}
	}
}

func TestAnswersInvalidPassesOnWellFormedQuestionIDs(t *testing.T) {
	const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
	body := func(ids string) []byte {
		return []byte(`{"type":"vetchium-problem-details/hub-application-answers-invalid",` +
			`"title":"Application answers invalid","status":422,"question_ids":` + ids + `}`)
	}
	refusal, ok := answersInvalid(commands.Response{Status: 422, Body: body(`["` + id + `"]`)})
	if !ok || len(refusal.QuestionIDs) != 1 || refusal.QuestionIDs[0] != id ||
		refusal.Detail != hubproblem.ApplicationAnswersInvalidError(nil).Detail {
		t.Fatalf("refusal = %+v, ok = %t", refusal, ok)
	}
	for name, response := range map[string]commands.Response{
		"wrong status":   {Status: 409, Body: body(`["` + id + `"]`)},
		"no ids":         {Status: 422, Body: body(`[]`)},
		"malformed id":   {Status: 422, Body: body(`["Q1"]`)},
		"other problem":  {Status: 409, Body: []byte(`{"type":"vetchium-problem-details/hub-application-exists","status":409}`)},
		"malformed body": {Status: 422, Body: []byte(`{`)},
	} {
		if _, ok := answersInvalid(response); ok {
			t.Errorf("%s passed on", name)
		}
	}
}
