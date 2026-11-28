package posts

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	postsspec "github.com/vetchium/src/typespec/hub/posts"
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	hubruntime "backend/internal/hub"
)

func TestListKeyBindsOwner(t *testing.T) {
	t.Parallel()
	s := &hubruntime.Server{CredentialKey: [32]byte{1}}
	owner := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	other := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	signed, err := signListKey(s, owner, "inner")
	if err != nil {
		t.Fatal(err)
	}
	if inner, ok := verifyListKey(s, owner, signed); !ok || inner != "inner" {
		t.Fatalf("verify = %q, %v", inner, ok)
	}
	if _, ok := verifyListKey(s, other, signed); ok {
		t.Fatal("a foreign owner accepted the key")
	}
	if _, ok := verifyListKey(s, owner, signed+"x"); ok {
		t.Fatal("a tampered key was accepted")
	}
	if _, ok := verifyListKey(s, owner, "inner"); ok {
		t.Fatal("an unsigned key was accepted")
	}
}

func TestEditProblemOrder(t *testing.T) {
	t.Parallel()
	live := sqlc.GetHubPostEditStateRow{
		Kind: sqlc.VetchiumHubPostKindPost, State: sqlc.VetchiumHubPostStateLive,
		Revision: 2, WindowOpen: true, PlanEntitled: true,
	}
	tests := []struct {
		name   string
		change func(*sqlc.GetHubPostEditStateRow)
		want   string
	}{
		{"removed", func(r *sqlc.GetHubPostEditStateRow) {
			r.State = sqlc.VetchiumHubPostStateRemoved
			r.WindowOpen = false
		}, hubproblem.HubPostNotFoundError.Type},
		{"window before revision", func(r *sqlc.GetHubPostEditStateRow) {
			r.WindowOpen = false
			r.Revision = 5
		}, hubproblem.HubPostEditClosedError.Type},
		{"revision before plan", func(r *sqlc.GetHubPostEditStateRow) {
			r.Revision = 5
			r.PlanEntitled = false
		}, hubproblem.HubPostConflictError.Type},
		{"plan", func(r *sqlc.GetHubPostEditStateRow) {
			r.PlanEntitled = false
		}, hubproblem.PlanRequiredError(subscriptionspec.SilverTier).Type},
		{"quote is never frozen", func(r *sqlc.GetHubPostEditStateRow) {
			r.Kind = sqlc.VetchiumHubPostKindQuote
			r.PlanEntitled = false
		}, hubproblem.HubPostConflictError.Type},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			state := live
			test.change(&state)
			got := editProblem(state, 2).ProblemDetails().Type
			if got != test.want {
				t.Errorf("editProblem = %q, want %q", got, test.want)
			}
		})
	}
}

func TestPolicyDefaultsToEveryone(t *testing.T) {
	t.Parallel()
	if got := replyPolicy(nil); got != sqlc.VetchiumHubPostPolicyEveryone {
		t.Errorf("reply policy default = %q", got)
	}
	if got := quotePolicy(nil); got != sqlc.VetchiumHubPostPolicyEveryone {
		t.Errorf("quote policy default = %q", got)
	}
	nobody := postsspec.ReplyNobody
	if got := replyPolicy(&nobody); got != sqlc.VetchiumHubPostPolicyNobody {
		t.Errorf("reply policy = %q", got)
	}
}

func TestEntitledPlansStartAtSilver(t *testing.T) {
	t.Parallel()
	plans := entitledPlans()
	if len(plans) == 0 {
		t.Fatal("no entitled plans")
	}
	for _, plan := range plans {
		if plan == "hub-free-tier" {
			t.Errorf("free plan entitled: %v", plans)
		}
	}
}
