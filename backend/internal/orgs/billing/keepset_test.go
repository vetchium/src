package billing

import (
	"fmt"
	"slices"
	"testing"
	"time"
)

func candidate(id string, superadmin, billing bool, joinedDay int) KeepCandidate {
	return KeepCandidate{
		ID: id, Superadmin: superadmin, ManageBilling: billing || superadmin,
		JoinedAt: date(2027, time.January, joinedDay, 0),
	}
}

func TestKeepSetOrder(t *testing.T) {
	t.Parallel()
	candidates := []KeepCandidate{
		candidate("member-old", false, false, 1),
		candidate("member-new", false, false, 20),
		candidate("finance-late", false, true, 25),
		candidate("admin-late", true, false, 28),
		candidate("member-mid", false, false, 10),
		candidate("admin-early", true, false, 3),
		candidate("finance-early", false, true, 4),
		candidate("member-tie-b", false, false, 15),
		candidate("member-tie-a", false, false, 15),
	}
	keep, disable := KeepSet(candidates)
	wantKeep := []string{"admin-early", "admin-late", "finance-early", "finance-late", "member-old"}
	wantDisable := []string{"member-mid", "member-tie-a", "member-tie-b", "member-new"}
	if !slices.Equal(keep, wantKeep) || !slices.Equal(disable, wantDisable) {
		t.Fatalf("keep = %v, disable = %v", keep, disable)
	}
}

func TestKeepSetKeepsEveryoneWhenTheyFit(t *testing.T) {
	t.Parallel()
	keep, disable := KeepSet([]KeepCandidate{
		candidate("a", true, false, 1), candidate("b", false, false, 2),
	})
	if len(keep) != 2 || len(disable) != 0 {
		t.Fatalf("keep = %v, disable = %v", keep, disable)
	}
	keep, disable = KeepSet(nil)
	if keep == nil || disable == nil || len(keep) != 0 || len(disable) != 0 {
		t.Fatalf("empty KeepSet() = %v, %v", keep, disable)
	}
}

func TestKeepSetAlwaysKeepsASuperadminEvenWhenManyOutrankByTenure(t *testing.T) {
	t.Parallel()
	candidates := make([]KeepCandidate, 0, 40)
	for index := range 39 {
		candidates = append(candidates, candidate(fmt.Sprintf("old-%02d", index), false, false, 1))
	}
	candidates = append(candidates, candidate("only-admin", true, false, 30))
	keep, _ := KeepSet(candidates)
	if keep[0] != "only-admin" || len(keep) != 5 {
		t.Fatalf("keep = %v", keep)
	}
}

func TestKeepSetDoesNotChangeItsInput(t *testing.T) {
	t.Parallel()
	candidates := []KeepCandidate{
		candidate("z", false, false, 9), candidate("a", true, false, 8),
	}
	before := slices.Clone(candidates)
	KeepSet(candidates)
	if !slices.Equal(candidates, before) {
		t.Fatal("KeepSet reordered the caller's slice")
	}
}
