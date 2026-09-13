package subscriptions

import (
	"encoding/json"
	"time"
)

type ScheduledPlanChange struct {
	PlanOID PlanOID `json:"plan_oid"`

	// Absent when the scheduled plan is FreeTier.
	BillingInterval *BillingInterval `json:"billing_interval,omitempty"`
}

type HubSubscription struct {
	PlanOID PlanOID `json:"plan_oid"`

	// Present exactly when the plan is paid.
	BillingInterval    *BillingInterval     `json:"billing_interval,omitempty"`
	CurrentPeriodStart *time.Time           `json:"current_period_start,omitempty"`
	CurrentPeriodEnd   *time.Time           `json:"current_period_end,omitempty"`
	CancelAtPeriodEnd  bool                 `json:"cancel_at_period_end"`
	ScheduledChange    *ScheduledPlanChange `json:"scheduled_change,omitempty"`
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
