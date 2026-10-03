package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func TestNoticeFor(t *testing.T) {
	t.Parallel()
	ending := monthlySilver()
	ending.ScheduledPlan = subscriptionspec.FreeTier
	inWeek := ending.PeriodEnd.Add(-3 * 24 * time.Hour)
	earlier := ending.PeriodEnd.Add(-20 * 24 * time.Hour)

	past := pastDue()
	got := NoticeFor(past, date(2027, time.February, 3, 0), false)
	if got == nil || got.Kind != NoticePaymentDue || !got.Banner ||
		!got.At.Equal(past.Open.DueAt) {
		t.Fatalf("past due, member: %+v", got)
	}

	// Past due wins over a pending schedule, for billing holders too.
	both := past
	both.ScheduledPlan = subscriptionspec.FreeTier
	if got := NoticeFor(both, date(2027, time.February, 3, 0), true); got == nil || got.Kind != NoticePaymentDue {
		t.Fatalf("past due with a schedule: %+v", got)
	}

	if got := NoticeFor(ending, inWeek, false); got != nil {
		t.Fatalf("a member saw the ending notice: %+v", got)
	}
	got = NoticeFor(ending, inWeek, true)
	if got == nil || got.Kind != NoticeSubscriptionEnding || !got.Banner ||
		got.ScheduledPlan != subscriptionspec.FreeTier || !got.At.Equal(ending.PeriodEnd) {
		t.Fatalf("billing holder in the final week: %+v", got)
	}
	got = NoticeFor(ending, earlier, true)
	if got == nil || got.Banner {
		t.Fatalf("billing holder before the final week: %+v", got)
	}
	if got := NoticeFor(monthlySilver(), inWeek, true); got != nil {
		t.Fatalf("a plain renewal produced a notice: %+v", got)
	}
}
