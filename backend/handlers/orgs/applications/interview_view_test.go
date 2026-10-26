package applications

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
)

func TestInterviewsDecodeWhatTheQueryAggregated(t *testing.T) {
	t.Parallel()
	empty, err := interviews([]byte(`[]`))
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty = %v, %v", empty, err)
	}
	list, err := interviews([]byte(`[{
		"interview_number": 2,
		"stage": {"id": "01900000-0000-7000-8000-000000000000",
			"name": "Panel", "kind": "interview"},
		"starts_at": "2026-12-01T09:00:00+05:30", "duration_minutes": 45,
		"mode": "in_person", "video_url": null, "location": "Room 4",
		"state": "scheduled", "applicant_response": "reschedule_requested",
		"reschedule_note": "Later?",
		"interviewers": null, "feedback": [{
			"interviewer_email": "a@example.com", "recommendation": "yes",
			"notes": "ok", "submitted_at": "2026-12-01T10:00:00+02:00"}]
	}]`))
	if err != nil || len(list) != 1 {
		t.Fatalf("list = %v, %v", list, err)
	}
	interview := list[0]
	if interview.StartsAt.Location().String() != "UTC" ||
		interview.StartsAt.Hour() != 3 || interview.VideoURL != nil ||
		*interview.Location != "Room 4" ||
		interview.ApplicantResponse != applications.ResponseRescheduleRequest ||
		interview.Interviewers == nil || len(interview.Interviewers) != 0 {
		t.Fatalf("interview = %+v", interview)
	}
	if interview.Feedback[0].SubmittedAt.Hour() != 8 ||
		interview.Feedback[0].InterviewerEmail != common.EmailAddress("a@example.com") {
		t.Fatalf("feedback = %+v", interview.Feedback)
	}
	if _, err := interviews([]byte(`{`)); err == nil {
		t.Fatal("malformed interviews decoded")
	}
}

func TestInterviewNumberIsAbsentWhenTheEntryHasNone(t *testing.T) {
	t.Parallel()
	if interviewNumber(pgtype.Int4{}) != nil {
		t.Fatal("a null interview number was reported")
	}
	if got := interviewNumber(pgtype.Int4{Int32: 3, Valid: true}); got == nil || *got != 3 {
		t.Fatalf("number = %v", got)
	}
}

func TestInvalidInterviewersDecode(t *testing.T) {
	t.Parallel()
	got, err := invalidInterviewers([]byte(`["a@example.com"]`))
	if err != nil || len(got) != 1 || got[0] != "a@example.com" {
		t.Fatalf("got = %v, %v", got, err)
	}
	if got, err := invalidInterviewers([]byte(`[]`)); err != nil || len(got) != 0 {
		t.Fatalf("empty = %v, %v", got, err)
	}
	if _, err := invalidInterviewers([]byte(`x`)); err == nil {
		t.Fatal("malformed list decoded")
	}
}

func TestInterviewEmailsKeepOrder(t *testing.T) {
	t.Parallel()
	got := interviewEmails([]common.EmailAddress{"b@example.com", "a@example.com"})
	if len(got) != 2 || got[0] != "b@example.com" || got[1] != "a@example.com" {
		t.Fatalf("emails = %v", got)
	}
}
