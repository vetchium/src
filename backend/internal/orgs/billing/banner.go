package billing

import (
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

// Notice is what my-info shows a user about the Org's billing.
type BannerNotice struct {
	Kind NoticeKind
	At   time.Time
	// ScheduledPlan is set for NoticeSubscriptionEnding.
	ScheduledPlan subscriptionspec.Plan
	Banner        bool
}

// NoticeFor chooses the notice a user sees. A past-due Org is shown to every
// user (D15); a plan-lowering schedule only to billing holders (D14). Past due
// wins when both apply, and the portal's banner is on for the whole grace
// period, but only for the final week for an ending subscription.
func NoticeFor(state State, now time.Time, billingHolder bool) *BannerNotice {
	if state.PastDue() && state.Open != nil {
		return &BannerNotice{
			Kind: NoticePaymentDue, At: state.Open.DueAt, Banner: true,
		}
	}
	if billingHolder && LowersPlan(state) {
		return &BannerNotice{
			Kind:          NoticeSubscriptionEnding,
			At:            state.PeriodEnd,
			ScheduledPlan: state.ScheduledPlan,
			Banner:        EndingBannerActive(state, now),
		}
	}
	return nil
}
