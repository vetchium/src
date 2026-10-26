package marketplace_test

import (
	"testing"

	"github.com/vetchium/src/typespec/orgs/marketplace"
)

func TestStatementsValidation(t *testing.T) {
	t.Parallel()
	if !marketplace.IsBillableFactKind(marketplace.FactJoined) {
		t.Fatal("expected FactJoined to be valid")
	}
	if !marketplace.IsBillableFactKind(marketplace.FactSeparated) {
		t.Fatal("expected FactSeparated to be valid")
	}
	if !marketplace.IsBillableFactKind(marketplace.FactInterviewCompleted) {
		t.Fatal("expected FactInterviewCompleted to be valid")
	}
	if !marketplace.IsBillableFactKind(marketplace.FactInterviewNoShow) {
		t.Fatal("expected FactInterviewNoShow to be valid")
	}
	if !marketplace.IsBillableFactKind(marketplace.FactAssessmentResult) {
		t.Fatal("expected FactAssessmentResult to be valid")
	}
	if !marketplace.IsBillableFactKind(marketplace.FactBackgroundCheckOutcome) {
		t.Fatal("expected FactBackgroundCheckOutcome to be valid")
	}
	if marketplace.IsBillableFactKind(marketplace.BillableFactKind("unknown")) {
		t.Fatal("expected unknown to be invalid")
	}

	if !marketplace.IsStatementMonth("2026-10") {
		t.Fatal("expected 2026-10 to be valid month")
	}
	if marketplace.IsStatementMonth("2026-13") {
		t.Fatal("expected 2026-13 to be invalid month")
	}
	if marketplace.IsStatementMonth("invalid") {
		t.Fatal("expected invalid to be invalid month")
	}

	req := marketplace.GetActivityStatementRequest{
		EngagementID: "018f6f5a-4b2a-7c9d-8e1f-2a3b4c5d6e7f",
		Month:        "2026-10",
	}
	if fields := req.Validate(); len(fields) != 0 {
		t.Fatalf("expected valid request, got %v", fields)
	}

	badReq := marketplace.GetActivityStatementRequest{
		EngagementID: "invalid-id",
		Month:        "bad-month",
	}
	if fields := badReq.Validate(); len(fields) != 2 {
		t.Fatalf("expected 2 fields, got %v", fields)
	}
}
