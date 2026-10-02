package billing

import (
	"encoding/json"
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
)

func opsOf(changes []InvoiceChange) []InvoiceOp {
	result := make([]InvoiceOp, len(changes))
	for index, change := range changes {
		result[index] = change.Op
	}
	return result
}

func TestFoldKeepsIndependentCreations(t *testing.T) {
	t.Parallel()
	_, transitions := Advance(monthlySilver(), date(2027, time.April, 15, 0), testConfig, alwaysPaid)
	changes := FoldInvoiceChanges(transitions)
	if len(changes) != 3 {
		t.Fatalf("changes = %v", opsOf(changes))
	}
	for _, change := range changes {
		if change.Op != InvoiceCreate || change.Invoice.State != subscriptionspec.InvoicePaid {
			t.Fatalf("change = %+v", change)
		}
	}
}

func TestFoldWritesAnOpenedThenVoidedInvoiceOnce(t *testing.T) {
	t.Parallel()
	// A worker that slept past both the renewal and the deadline.
	_, transitions := Advance(monthlySilver(), date(2027, time.February, 20, 0), testConfig, alwaysDeclined)
	if len(transitions) != 2 {
		t.Fatalf("transitions = %v", kinds(transitions))
	}
	changes := FoldInvoiceChanges(transitions)
	if len(changes) != 1 || changes[0].Op != InvoiceCreate ||
		changes[0].Invoice.State != subscriptionspec.InvoiceVoid ||
		changes[0].Invoice.VoidedAt.IsZero() {
		t.Fatalf("changes = %+v", changes)
	}
}

func TestFoldKeepsOnlyTheLastWriteToAStoredInvoice(t *testing.T) {
	t.Parallel()
	state := pastDue()
	got, transitions := Advance(state, date(2027, time.February, 13, 0), testConfig, alwaysDeclined)
	if len(transitions) != 1 || !got.PastDue() {
		t.Fatalf("transitions = %v", kinds(transitions))
	}
	changes := FoldInvoiceChanges(transitions)
	if len(changes) != 1 || changes[0].Op != InvoiceRecordFailure {
		t.Fatalf("changes = %v", opsOf(changes))
	}

	// A retry failure followed by the deadline is one void.
	later, more := Advance(got, date(2027, time.February, 16, 0), testConfig, alwaysDeclined)
	if later.Plan != subscriptionspec.FreeTier {
		t.Fatalf("state = %+v", later)
	}
	folded := FoldInvoiceChanges(append(transitions, more...))
	if len(folded) != 1 || folded[0].Op != InvoiceVoid {
		t.Fatalf("folded = %v", opsOf(folded))
	}
}

func TestFoldKeepsAStoredWriteAndNewCreations(t *testing.T) {
	t.Parallel()
	// Paying the stored invoice does not hide a later paid invoice.
	paid, transition, _ := Pay(pastDue(), date(2027, time.February, 2, 0), alwaysPaid)
	if paid.PastDue() {
		t.Fatal("pay did not settle")
	}
	upgrade := Decide(paid, request(subscriptionspec.GoldTier, subscriptionspec.Month, 1),
		date(2027, time.February, 3, 0), alwaysPaid)
	folded := FoldInvoiceChanges([]Transition{*transition, *upgrade.Transition})
	if len(folded) != 2 || folded[0].Op != InvoiceCreate || folded[1].Op != InvoicePay {
		t.Fatalf("folded = %v", opsOf(folded))
	}
	if len(FoldInvoiceChanges(nil)) != 0 {
		t.Fatal("no transitions must fold to no changes")
	}
}

func TestInvoiceChangesJSONEncodesAnArray(t *testing.T) {
	t.Parallel()
	encoded, err := InvoiceChangesJSON(nil)
	if err != nil || string(encoded) != "[]" {
		t.Fatalf("empty = %s, %v", encoded, err)
	}
	_, transitions := Advance(monthlySilver(), date(2027, time.February, 2, 0), testConfig, alwaysDeclined)
	encoded, err = InvoiceChangesJSON(FoldInvoiceChanges(transitions))
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	if err := json.Unmarshal(encoded, &records); err != nil || len(records) != 1 {
		t.Fatalf("records = %s, %v", encoded, err)
	}
	record := records[0]
	if record["op"] != "create" || record["state"] != "open" ||
		record["last_failure"] != "declined" || record["due_at"] == nil ||
		record["paid_at"] != nil {
		t.Fatalf("record = %v", record)
	}
}
