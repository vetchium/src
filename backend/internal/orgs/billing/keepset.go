package billing

import (
	"slices"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// KeepCandidate is one active user considered when an Org drops to Free.
type KeepCandidate struct {
	ID string

	// Superadmin and ManageBilling are effective permissions, so a user
	// holding the first also holds the second.
	Superadmin    bool
	ManageBilling bool

	JoinedAt time.Time
}

// KeepSet returns the IDs of the users who stay active when an Org drops to
// the Free plan, and the IDs of those disabled. It keeps as many as the Free
// plan allows, in this order: superadmins, then billing holders, then the
// longest-standing users, ties broken by ID. At least one superadmin always
// stays when the Org has one, so the lockout invariant holds.
func KeepSet(candidates []KeepCandidate) (keep, disable []string) {
	limit, _ := subscriptionspec.MaxUsers(subscriptionspec.FreeTier, false)
	ordered := slices.Clone(candidates)
	slices.SortFunc(ordered, func(a, b KeepCandidate) int {
		if a.Superadmin != b.Superadmin {
			if a.Superadmin {
				return -1
			}
			return 1
		}
		if a.ManageBilling != b.ManageBilling {
			if a.ManageBilling {
				return -1
			}
			return 1
		}
		if c := a.JoinedAt.Compare(b.JoinedAt); c != 0 {
			return c
		}
		return compareStrings(a.ID, b.ID)
	})
	keep = []string{}
	disable = []string{}
	for index, candidate := range ordered {
		if index < limit {
			keep = append(keep, candidate.ID)
		} else {
			disable = append(disable, candidate.ID)
		}
	}
	return keep, disable
}

func compareStrings(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}
