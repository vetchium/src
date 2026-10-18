package orgai

import (
	"slices"
	"testing"
	"time"

	aispec "github.com/vetchium/src/typespec/orgs/ai"

	"backend/internal/appconfig"
)

func testRuntime(withdrawsAt *time.Time) *Runtime {
	return &Runtime{Config: appconfig.AI{
		Models: []appconfig.AIModel{
			{OID: "qwen", MaxOutputTokens: 1024},
			{OID: "ministral", MaxOutputTokens: 1024, WithdrawsAt: withdrawsAt},
			{OID: "gemma", MaxOutputTokens: 1024},
		},
		OperationDefaults: map[aispec.AIOperation]aispec.AIModelOID{
			aispec.OpeningDraft: "qwen",
		},
	}}
}

func oids(models []appconfig.AIModel) []aispec.AIModelOID {
	result := make([]aispec.AIModelOID, 0, len(models))
	for _, model := range models {
		result = append(result, model.OID)
	}
	return result
}

func TestEffectivePolicyOff(t *testing.T) {
	t.Parallel()
	off := &Policy{AllowedModels: []aispec.AIModelOID{}}
	if !off.Off() || (*Policy)(nil).Off() {
		t.Fatal("Off() misreports an empty or missing policy")
	}
	allowed, choice := testRuntime(nil).Effective(
		aispec.OpeningDraft, off, time.Now(),
	)
	if len(allowed) != 0 || choice != nil {
		t.Fatalf("Effective() = %v, %v, want no models", oids(allowed), choice)
	}
}

func TestEffectivePolicy(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)
	cases := []struct {
		name        string
		withdraws   *time.Time
		stored      *Policy
		wantAllowed []aispec.AIModelOID
		wantDefault aispec.AIModelOID
	}{
		{"no policy allows every offered model", nil, nil,
			[]aispec.AIModelOID{"qwen", "ministral", "gemma"}, "qwen"},
		{"deprecated is still offered", &future, nil,
			[]aispec.AIModelOID{"qwen", "ministral", "gemma"}, "qwen"},
		{"withdrawn is not offered", &past, nil,
			[]aispec.AIModelOID{"qwen", "gemma"}, "qwen"},
		{"stored policy narrows", nil,
			&Policy{AllowedModels: []aispec.AIModelOID{"gemma", "ministral"}, DefaultModel: "gemma"},
			[]aispec.AIModelOID{"ministral", "gemma"}, "gemma"},
		{"withdrawn default falls back to the region default", &past,
			&Policy{AllowedModels: []aispec.AIModelOID{"ministral", "gemma"}, DefaultModel: "ministral"},
			[]aispec.AIModelOID{"gemma", "qwen"}, "qwen"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			allowed, choice := testRuntime(testCase.withdraws).Effective(
				aispec.OpeningDraft, testCase.stored, now,
			)
			if !slices.Equal(oids(allowed), testCase.wantAllowed) {
				t.Fatalf("allowed = %v, want %v", oids(allowed), testCase.wantAllowed)
			}
			if choice == nil || *choice != testCase.wantDefault {
				t.Fatalf("default = %v, want %v", choice, testCase.wantDefault)
			}
		})
	}
}

func TestAvailability(t *testing.T) {
	t.Parallel()
	ready := Standing{
		Enabled: true, TermsCurrent: true, PlanAllowsAI: true,
		Balance: Balance(Lots{GrantRemaining: 100, GrantTotal: 100}),
	}
	cases := []struct {
		name   string
		change func(*Standing)
		want   aispec.AIAvailability
	}{
		{"ready", func(*Standing) {}, aispec.Ready},
		{"off", func(s *Standing) { s.Enabled = false }, aispec.NotEnabled},
		{"stale terms", func(s *Standing) { s.TermsCurrent = false }, aispec.NotEnabled},
		{"no plan, no purchase", func(s *Standing) {
			s.PlanAllowsAI = false
			s.Balance = Balance(Lots{})
		}, aispec.PlanRequired},
		{"no plan outranks off", func(s *Standing) {
			s.Enabled = false
			s.PlanAllowsAI = false
			s.Balance = Balance(Lots{})
		}, aispec.PlanRequired},
		{"no plan but purchased credits", func(s *Standing) {
			s.PlanAllowsAI = false
			s.Balance = Balance(Lots{PurchasedRemaining: 50, PurchasedTotal: 50})
		}, aispec.Ready},
		{"all reserved", func(s *Standing) {
			s.Balance = Balance(Lots{GrantRemaining: 100, GrantTotal: 100, Reserved: 100})
		}, aispec.NoCredits},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			standing := ready
			testCase.change(&standing)
			if got := standing.Availability(); got != testCase.want {
				t.Fatalf("Availability() = %q, want %q", got, testCase.want)
			}
		})
	}
	if Balance(Lots{GrantRemaining: 10, PurchasedRemaining: 5, Reserved: 30}).Available != 0 {
		t.Fatal("available never goes negative")
	}
}

func TestPermissions(t *testing.T) {
	t.Parallel()
	if permission, ok := OperationPermission(aispec.OpeningDraft); !ok ||
		permission != "org:manage_openings" {
		t.Fatal("drafting needs org:manage_openings")
	}
	if _, ok := OperationPermission("org-future"); ok {
		t.Fatal("an unknown operation has no permission")
	}
	if permission, ok := TextReadPermission("org-opening-draft"); !ok ||
		permission != "org:view_openings" {
		t.Fatal("drafting text needs org:view_openings")
	}
	if _, ok := TextReadPermission("org-future"); ok {
		t.Fatal("an unknown operation's text is readable by nobody")
	}
}
