package pipelines

import (
	"slices"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/orgs/hiring"
)

func TestWithCriterionIDsAssignsNewAndReportsUnheld(t *testing.T) {
	t.Parallel()
	kept := hiring.FeedbackCriterionID("01900000-0000-7000-8000-000000000001")
	stray := hiring.FeedbackCriterionID("01900000-0000-7000-8000-000000000002")
	form := []hiring.FeedbackCriterion{
		{ID: &kept, Text: "Depth", Type: hiring.CriterionRating},
		{Text: "Fit", Type: hiring.CriterionYesNo},
		{ID: &stray, Text: "Notes", Type: hiring.CriterionText},
	}
	stored, unknown, err := withCriterionIDs(time.Now(), "stages.1.feedback_form", form,
		criterionIDs([]hiring.FeedbackCriterion{form[0]}))
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(unknown, []string{"stages.1.feedback_form.2.id"}) {
		t.Fatalf("unknown = %v", unknown)
	}
	if *stored[0].ID != kept || stored[1].ID == nil || !hiring.IsFeedbackCriterionID(*stored[1].ID) {
		t.Fatalf("stored = %+v", stored)
	}
	if form[1].ID != nil {
		t.Fatal("the caller's form gained an id")
	}
	if stored, unknown, err := withCriterionIDs(time.Now(), "f", nil, nil); err != nil || stored == nil || unknown != nil {
		t.Fatalf("nil form: stored = %v, unknown = %v, err = %v", stored, unknown, err)
	}
}
