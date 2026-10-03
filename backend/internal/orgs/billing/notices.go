package billing

import (
	"slices"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// NoticeKind names a warning sent to billing holders.
type NoticeKind string

const (
	// NoticePaymentDue warns that an open invoice's deadline is near, after
	// which users beyond the Free plan are disabled.
	NoticePaymentDue NoticeKind = "payment-due"
	// NoticeSubscriptionEnding warns that a scheduled change will lower the
	// plan at period end.
	NoticeSubscriptionEnding NoticeKind = "subscription-ending"
)

// BannerWindow is how long before a plan-lowering change the in-portal banner
// shows.
const BannerWindow = 7 * 24 * time.Hour

// Notice is a warning due now. The caller records (Kind, TargetAt, Lead) with
// ON CONFLICT DO NOTHING and sends only when the row is new.
type Notice struct {
	Kind     NoticeKind
	TargetAt time.Time
	Lead     time.Duration
}

// PendingNotices returns the warnings that are due at now. For each target
// instant only the closest lead inside its window is returned, so a worker
// that was down never sends a stale seven-day warning inside the one-day
// window. A warning is due only before its target.
func PendingNotices(
	state State, now time.Time, dueLeads, endingLeads []time.Duration,
) []Notice {
	var notices []Notice
	if state.PastDue() && state.Open != nil {
		if notice, ok := closestLead(
			NoticePaymentDue, state.Open.DueAt, now, dueLeads,
		); ok {
			notices = append(notices, notice)
		}
	}
	if LowersPlan(state) {
		if notice, ok := closestLead(
			NoticeSubscriptionEnding, state.PeriodEnd, now, endingLeads,
		); ok {
			notices = append(notices, notice)
		}
	}
	return notices
}

func closestLead(
	kind NoticeKind, target, now time.Time, leads []time.Duration,
) (Notice, bool) {
	if !now.Before(target) {
		return Notice{}, false
	}
	for _, lead := range slices.Sorted(slices.Values(leads)) {
		if !now.Before(target.Add(-lead)) {
			return Notice{Kind: kind, TargetAt: target, Lead: lead}, true
		}
	}
	return Notice{}, false
}

// LowersPlan reports whether the state has a scheduled change that lowers the
// plan rank. A renewal, an interval change, and a reselection do not warn.
func LowersPlan(state State) bool {
	return state.Plan != subscriptionspec.FreeTier && state.HasSchedule() &&
		subscriptionspec.Rank(state.ScheduledPlan) <
			subscriptionspec.Rank(state.Plan)
}

// EndingBannerActive reports whether billing holders see the in-portal
// warning that the plan is about to drop.
func EndingBannerActive(state State, now time.Time) bool {
	return LowersPlan(state) && now.Before(state.PeriodEnd) &&
		!now.Before(state.PeriodEnd.Add(-BannerWindow))
}
