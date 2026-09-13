package subscriptions

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestOptionalBillingIntervalDecoding(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		json        string
		wantPresent bool
		wantNull    bool
		wantValue   BillingInterval
		wantErr     bool
	}{
		{"absent", `{}`, false, false, "", false},
		{"null", `{"billing_interval":null}`, true, true, "", false},
		{"month", `{"billing_interval":"month"}`, true, false, Month, false},
		{
			"unknown string", `{"billing_interval":"week"}`, true, false,
			"week", false,
		},
		{"number", `{"billing_interval":1}`, false, false, "", true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			var wrapper struct {
				BillingInterval OptionalBillingInterval `json:"billing_interval,omitzero"`
			}
			err := json.Unmarshal([]byte(testCase.json), &wrapper)
			if testCase.wantErr {
				if err == nil {
					t.Fatal("expected a decoding error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if wrapper.BillingInterval.Present != testCase.wantPresent ||
				wrapper.BillingInterval.Null != testCase.wantNull ||
				wrapper.BillingInterval.Value != testCase.wantValue {
				t.Fatalf(
					"decoded %+v, want present=%t null=%t value=%q",
					wrapper.BillingInterval, testCase.wantPresent,
					testCase.wantNull, testCase.wantValue,
				)
			}
		})
	}
}

func TestOptionalBillingIntervalEncoding(t *testing.T) {
	t.Parallel()
	type wrapper struct {
		BillingInterval OptionalBillingInterval `json:"billing_interval,omitzero"`
	}
	cases := []struct {
		name  string
		value OptionalBillingInterval
		want  string
	}{
		{"absent", OptionalBillingInterval{}, `{}`},
		{
			"null", OptionalBillingInterval{Present: true, Null: true},
			`{"billing_interval":null}`,
		},
		{
			"value", OptionalBillingInterval{Present: true, Value: Month},
			`{"billing_interval":"month"}`,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			encoded, err := json.Marshal(wrapper{BillingInterval: testCase.value})
			if err != nil {
				t.Fatal(err)
			}
			if string(encoded) != testCase.want {
				t.Fatalf("encoded %s, want %s", encoded, testCase.want)
			}
			var roundTripped wrapper
			if err := json.Unmarshal(encoded, &roundTripped); err != nil {
				t.Fatal(err)
			}
			if roundTripped.BillingInterval != testCase.value {
				t.Fatalf(
					"round trip = %+v, want %+v",
					roundTripped.BillingInterval, testCase.value,
				)
			}
		})
	}
}

func TestSetSubscriptionPlanRequestValidate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		request SetSubscriptionPlanRequest
		want    []string
	}{
		{
			"valid free", SetSubscriptionPlanRequest{PlanOID: FreeTier},
			[]string{},
		},
		{
			"valid silver monthly",
			SetSubscriptionPlanRequest{
				PlanOID: SilverTier,
				BillingInterval: OptionalBillingInterval{
					Present: true, Value: Month,
				},
			},
			[]string{},
		},
		{
			"unknown plan", SetSubscriptionPlanRequest{PlanOID: "hub-gold-tier"},
			[]string{"plan_oid"},
		},
		{
			"interval with free tier",
			SetSubscriptionPlanRequest{
				PlanOID: FreeTier,
				BillingInterval: OptionalBillingInterval{
					Present: true, Value: Month,
				},
			},
			[]string{"billing_interval"},
		},
		{
			"null interval with free tier",
			SetSubscriptionPlanRequest{
				PlanOID:         FreeTier,
				BillingInterval: OptionalBillingInterval{Present: true, Null: true},
			},
			[]string{"billing_interval"},
		},
		{
			"missing interval for silver",
			SetSubscriptionPlanRequest{PlanOID: SilverTier},
			[]string{"billing_interval"},
		},
		{
			"null interval with silver",
			SetSubscriptionPlanRequest{
				PlanOID:         SilverTier,
				BillingInterval: OptionalBillingInterval{Present: true, Null: true},
			},
			[]string{"billing_interval"},
		},
		{
			"unknown interval",
			SetSubscriptionPlanRequest{
				PlanOID: SilverTier,
				BillingInterval: OptionalBillingInterval{
					Present: true, Value: "week",
				},
			},
			[]string{"billing_interval"},
		},
		{
			"unknown plan and interval both invalid",
			SetSubscriptionPlanRequest{
				PlanOID: "hub-gold-tier",
				BillingInterval: OptionalBillingInterval{
					Present: true, Null: true,
				},
			},
			[]string{"plan_oid", "billing_interval"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got := testCase.request.Validate()
			if !slices.Equal(got, testCase.want) {
				t.Fatalf("Validate() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestSetSubscriptionPlanRequestNormalizeIsEmpty(t *testing.T) {
	t.Parallel()
	request := SetSubscriptionPlanRequest{PlanOID: SilverTier}
	request.Normalize()
	if request.PlanOID != SilverTier {
		t.Fatal("Normalize mutated the request")
	}
}
