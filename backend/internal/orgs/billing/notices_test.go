package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

var (
	dueLeads    = []time.Duration{168 * time.Hour, 72 * time.Hour, 24 * time.Hour}
	endingLeads = []time.Duration{168 * time.Hour, 24 * time.Hour}
)

func TestPendingNoticesForAnOpenInvoice(t *testing.T) {
	t.Parallel()
	state := pastDue() // due Feb 15 00:00
	due := state.Open.DueAt
	cases := []struct {
		name string
		now  time.Time
		want time.Duration
	}{
		{"before any window", due.Add(-8 * 24 * time.Hour), 0},
		{"seven days out", due.Add(-168 * time.Hour), 168 * time.Hour},
		{"six days out", due.Add(-6 * 24 * time.Hour), 168 * time.Hour},
		{"three days out", due.Add(-72 * time.Hour), 72 * time.Hour},
		{"two days out sends only the three-day notice", due.Add(-48 * time.Hour), 72 * time.Hour},
		{"inside the last day sends only the one-day notice", due.Add(-time.Hour), 24 * time.Hour},
		{"at the deadline", due, 0},
		{"after the deadline", due.Add(time.Hour), 0},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := PendingNotices(state, testCase.now, dueLeads, endingLeads)
			if testCase.want == 0 {
				if len(got) != 0 {
					t.Fatalf("PendingNotices() = %+v", got)
				}
				return
			}
			if len(got) != 1 || got[0].Kind != NoticePaymentDue ||
				got[0].Lead != testCase.want || !got[0].TargetAt.Equal(due) {
				t.Fatalf("PendingNotices() = %+v", got)
			}
		})
	}
}

func TestPendingNoticesForAPlanLoweringSchedule(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.ScheduledPlan = subscriptionspec.FreeTier
	end := state.PeriodEnd

	got := PendingNotices(state, end.Add(-6*24*time.Hour), dueLeads, endingLeads)
	if len(got) != 1 || got[0].Kind != NoticeSubscriptionEnding ||
		got[0].Lead != 168*time.Hour || !got[0].TargetAt.Equal(end) {
		t.Fatalf("PendingNotices() = %+v", got)
	}
	got = PendingNotices(state, end.Add(-2*time.Hour), dueLeads, endingLeads)
	if len(got) != 1 || got[0].Lead != 24*time.Hour {
		t.Fatalf("inside the last day = %+v", got)
	}
	if got := PendingNotices(state, end.Add(-10*24*time.Hour), dueLeads, endingLeads); len(got) != 0 {
		t.Fatalf("too early = %+v", got)
	}
	if got := PendingNotices(state, end, dueLeads, endingLeads); len(got) != 0 {
		t.Fatalf("at period end = %+v", got)
	}
}

func TestPendingNoticesOnlyForRankLoweringChanges(t *testing.T) {
	t.Parallel()
	now := func(state State) time.Time { return state.PeriodEnd.Add(-2 * time.Hour) }

	monthly := monthlySilver()
	if got := PendingNotices(monthly, now(monthly), dueLeads, endingLeads); len(got) != 0 {
		t.Fatalf("a plain renewal warned: %+v", got)
	}

	annualToMonthly := monthlySilver()
	annualToMonthly.Interval = subscriptionspec.Year
	annualToMonthly.ScheduledPlan = subscriptionspec.SilverTier
	annualToMonthly.ScheduledInterval = subscriptionspec.Month
	if got := PendingNotices(annualToMonthly, now(annualToMonthly), dueLeads, endingLeads); len(got) != 0 {
		t.Fatalf("an interval change warned: %+v", got)
	}

	goldToSilver := monthlySilver()
	goldToSilver.Plan = subscriptionspec.GoldTier
	goldToSilver.ScheduledPlan = subscriptionspec.SilverTier
	goldToSilver.ScheduledInterval = subscriptionspec.Month
	if got := PendingNotices(goldToSilver, now(goldToSilver), dueLeads, endingLeads); len(got) != 1 {
		t.Fatalf("a downgrade did not warn: %+v", got)
	}
	if got := PendingNotices(freeState(), date(2027, 1, 1, 0), dueLeads, endingLeads); len(got) != 0 {
		t.Fatalf("free warned: %+v", got)
	}
}

func TestEndingBannerWindow(t *testing.T) {
	t.Parallel()
	state := monthlySilver()
	state.ScheduledPlan = subscriptionspec.FreeTier
	end := state.PeriodEnd
	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		{"eight days out", end.Add(-8 * 24 * time.Hour), false},
		{"exactly seven days out", end.Add(-BannerWindow), true},
		{"one day out", end.Add(-24 * time.Hour), true},
		{"at period end", end, false},
	}
	for _, testCase := range cases {
		if got := EndingBannerActive(state, testCase.now); got != testCase.want {
			t.Fatalf("%s: EndingBannerActive() = %t, want %t", testCase.name, got, testCase.want)
		}
	}
	if EndingBannerActive(monthlySilver(), end.Add(-time.Hour)) {
		t.Fatal("the banner showed without a plan-lowering schedule")
	}
}
