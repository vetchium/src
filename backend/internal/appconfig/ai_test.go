package appconfig

import (
	"strings"
	"testing"
	"time"

	aispec "github.com/vetchium/src/typespec/orgs/ai"
)

func validFileAI() fileAI {
	return fileAI{
		RequestTimeout: "120s", ReservationTimeout: "10m",
		TextRetention: "4320h", GrantCreditsInterval: "1m",
		ReleaseReservationsInterval: "1m",
		Models: []fileAIModel{{
			OID: "qwen3-1-7b", DisplayName: "Qwen3 1.7B", Vendor: "Qwen",
			Licence: "Apache-2.0", BaseURL: "http://ai-dev:8080/engines/v1",
			HostModel: "ai/qwen3:1.7b", MaxOutputTokens: 3072,
			ChatTemplateKwargs:            []byte(`{"enable_thinking":false}`),
			InputCreditsPerMillionTokens:  20000,
			OutputCreditsPerMillionTokens: 60000,
		}},
		OperationDefaults: map[string]aispec.AIModelOID{
			"org-opening-draft": "qwen3-1-7b",
		},
		CreditPacks: []fileAICreditPack{{
			ID: "credits-100k", Credits: 100000, PriceCurrency: "USD",
			PriceAmountMinor: 1000,
		}},
	}
}

func TestParseAI(t *testing.T) {
	t.Parallel()
	parsed, err := parseAI(validFileAI())
	if err != nil {
		t.Fatal(err)
	}
	model, ok := parsed.Model("qwen3-1-7b")
	if !ok || model.HostModel != "ai/qwen3:1.7b" || model.WithdrawsAt != nil ||
		parsed.TextRetention != 4320*time.Hour || len(parsed.CreditPacks) != 1 {
		t.Fatalf("parsed = %+v", parsed)
	}
	if _, ok := parsed.Pack("credits-100k"); !ok {
		t.Fatal("pack not found")
	}
}

func TestParseAIRejects(t *testing.T) {
	t.Parallel()
	withdraws := "2026-12-01T00:00:00Z"
	cases := []struct {
		name   string
		change func(*fileAI)
		want   string
	}{
		{"reservation not above request", func(a *fileAI) { a.ReservationTimeout = "120s" }, "reservationTimeout"},
		{"no models", func(a *fileAI) { a.Models = nil }, "models must not be empty"},
		{"bad oid", func(a *fileAI) { a.Models[0].OID = "Qwen" }, "oid"},
		{"duplicate model", func(a *fileAI) { a.Models = append(a.Models, a.Models[0]) }, "duplicate"},
		{"bad base URL", func(a *fileAI) { a.Models[0].BaseURL = "ai-dev:8080" }, "baseURL"},
		{"no host model", func(a *fileAI) { a.Models[0].HostModel = "" }, "hostModel"},
		{"tiny output", func(a *fileAI) { a.Models[0].MaxOutputTokens = 10 }, "maxOutputTokens"},
		{"negative rate", func(a *fileAI) { a.Models[0].InputCreditsPerMillionTokens = -1 }, "credit rates"},
		{"kwargs not object", func(a *fileAI) { a.Models[0].ChatTemplateKwargs = []byte(`[1]`) }, "chatTemplateKwargs"},
		{"bad withdrawal", func(a *fileAI) { a.Models[0].WithdrawsAt = "soon" }, "withdrawsAt"},
		{"deprecated default", func(a *fileAI) { a.Models[0].WithdrawsAt = withdraws }, "operationDefaults"},
		{"unknown operation", func(a *fileAI) { a.OperationDefaults["org-future"] = "qwen3-1-7b" }, "unknown operation"},
		{"missing default", func(a *fileAI) { delete(a.OperationDefaults, "org-opening-draft") }, "must name a model"},
		{"unknown default model", func(a *fileAI) { a.OperationDefaults["org-opening-draft"] = "gemma" }, "operationDefaults"},
		{"bad pack", func(a *fileAI) { a.CreditPacks[0].ID = "Pack" }, "lowercase slug"},
		{"empty pack", func(a *fileAI) { a.CreditPacks[0].Credits = 0 }, "credits must be positive"},
		{"bad currency", func(a *fileAI) { a.CreditPacks[0].PriceCurrency = "usd" }, "ISO 4217"},
		{"two currencies", func(a *fileAI) {
			a.CreditPacks = append(a.CreditPacks, fileAICreditPack{
				ID: "other", Credits: 1, PriceCurrency: "EUR",
			})
		}, "one currency"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			raw := validFileAI()
			testCase.change(&raw)
			_, err := parseAI(raw)
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("parseAI() error = %v, want %q", err, testCase.want)
			}
		})
	}
}

func TestModelOfferedUntilWithdrawal(t *testing.T) {
	t.Parallel()
	withdraws := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	model := AIModel{WithdrawsAt: &withdraws}
	if !model.OfferedAt(withdraws.Add(-time.Second)) || model.OfferedAt(withdraws) {
		t.Fatal("a model is offered strictly before its withdrawal")
	}
	if !(AIModel{}).OfferedAt(withdraws) {
		t.Fatal("a model without a withdrawal date is always offered")
	}
}
