package subscriptions

import (
	"encoding/json"
	"time"

	"github.com/vetchium/src/typespec/common"
)

type ScheduledPlanChange struct {
	PlanOID PlanOID `json:"plan_oid"`

	// Absent when the scheduled plan is FreeTier.
	BillingInterval *BillingInterval `json:"billing_interval,omitempty"`
}

// OrgInvoice is a charge for one period. It carries no amount: while
// payments are simulated the portal owns the display prices.
type OrgInvoice struct {
	InvoiceID       string          `json:"invoice_id"`
	PlanOID         PlanOID         `json:"plan_oid"`
	BillingInterval BillingInterval `json:"billing_interval"`
	PeriodStart     time.Time       `json:"period_start"`
	PeriodEnd       time.Time       `json:"period_end"`
	Reason          InvoiceReason   `json:"reason"`
	State           InvoiceState    `json:"state"`
	CreatedAt       time.Time       `json:"created_at"`

	// DueAt and LastFailure are present while the invoice is open.
	DueAt       *time.Time      `json:"due_at,omitempty"`
	PaidAt      *time.Time      `json:"paid_at,omitempty"`
	LastFailure *InvoiceFailure `json:"last_failure,omitempty"`

	AttemptCount int32 `json:"attempt_count"`
}

type OrgPaymentMethod struct {
	Kind PaymentMethodKind `json:"kind"`
}

type OrgSubscription struct {
	PlanOID PlanOID `json:"plan_oid"`

	// Present exactly when the plan is paid.
	BillingInterval    *BillingInterval `json:"billing_interval,omitempty"`
	CurrentPeriodStart *time.Time       `json:"current_period_start,omitempty"`
	CurrentPeriodEnd   *time.Time       `json:"current_period_end,omitempty"`

	CancelAtPeriodEnd bool                 `json:"cancel_at_period_end"`
	ScheduledChange   *ScheduledPlanChange `json:"scheduled_change,omitempty"`
	BillingState      BillingState         `json:"billing_state"`

	// OpenInvoice is present exactly when the Org is past due.
	OpenInvoice   *OrgInvoice       `json:"open_invoice,omitempty"`
	PaymentMethod *OrgPaymentMethod `json:"payment_method,omitempty"`

	SeatsInUse int32 `json:"seats_in_use"`

	// SeatLimit is absent while the Org has no seat cap.
	SeatLimit *int32 `json:"seat_limit,omitempty"`
}

// OptionalBillingInterval distinguishes an absent billing_interval member
// from an explicit null, which a plain *BillingInterval field cannot: both
// decode to a nil pointer, so Validate could not reject null while accepting
// absence.
type OptionalBillingInterval struct {
	Value   BillingInterval
	Present bool
	Null    bool
}

// IsZero lets the field use `json:",omitzero"`: an absent value is omitted
// from the encoded request.
func (o OptionalBillingInterval) IsZero() bool {
	return !o.Present
}

// UnmarshalJSON is called by encoding/json even for the literal null, because
// OptionalBillingInterval implements json.Unmarshaler on a non-pointer field.
func (o *OptionalBillingInterval) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Null = true
		o.Value = ""
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Null = false
	o.Value = BillingInterval(value)
	return nil
}

func (o OptionalBillingInterval) MarshalJSON() ([]byte, error) {
	if o.Null {
		return []byte("null"), nil
	}
	return json.Marshal(string(o.Value))
}

type SetSubscriptionPlanRequest struct {
	PlanOID         Plan                    `json:"plan_oid"`
	BillingInterval OptionalBillingInterval `json:"billing_interval,omitzero"`
}

func (r *SetSubscriptionPlanRequest) Normalize() {}

func (r SetSubscriptionPlanRequest) Validate() []string {
	fields := make([]string, 0, 2)
	validPlan := IsPlan(PlanOID(r.PlanOID))
	if !validPlan {
		fields = append(fields, "plan_oid")
	}
	switch {
	case r.BillingInterval.Null:
		fields = append(fields, "billing_interval")
	case r.BillingInterval.Present &&
		!IsBillingInterval(r.BillingInterval.Value):
		fields = append(fields, "billing_interval")
	case validPlan &&
		RequiresBillingInterval(r.PlanOID) != r.BillingInterval.Present:
		fields = append(fields, "billing_interval")
	}
	return fields
}

type SetPaymentMethodRequest struct {
	Kind PaymentMethodKind `json:"kind"`
}

func (r *SetPaymentMethodRequest) Normalize() {}

func (r SetPaymentMethodRequest) Validate() []string {
	if !IsPaymentMethodKind(r.Kind) {
		return []string{"kind"}
	}
	return []string{}
}

type ListInvoicesRequest struct {
	Limit         *common.PageSize      `json:"limit,omitempty"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
}

func (r ListInvoicesRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r *ListInvoicesRequest) Normalize() {}

func (r ListInvoicesRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	return fields
}

type ListInvoicesResponse struct {
	Invoices          []OrgInvoice          `json:"invoices"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type PayInvoiceRequest struct {
	InvoiceID string `json:"invoice_id"`
}

func (r *PayInvoiceRequest) Normalize() {}

func (r PayInvoiceRequest) Validate() []string {
	if !IsInvoiceID(r.InvoiceID) {
		return []string{"invoice_id"}
	}
	return []string{}
}

// IsInvoiceID reports whether value is a canonical lowercase UUID.
func IsInvoiceID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			isDigit := char >= '0' && char <= '9'
			isLowerHex := char >= 'a' && char <= 'f'
			if !isDigit && !isLowerHex {
				return false
			}
		}
	}
	return true
}
