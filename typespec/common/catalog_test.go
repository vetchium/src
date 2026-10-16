package common

import "testing"

func TestCurrencyCatalog(t *testing.T) {
	t.Parallel()
	for _, code := range []CurrencyCode{"USD", "EUR", "INR"} {
		if !IsCurrencyCode(code) {
			t.Errorf("active currency %q rejected", code)
		}
	}
	for _, code := range []CurrencyCode{"usd", "ZZZ", "", "US"} {
		if IsCurrencyCode(code) {
			t.Errorf("invalid currency %q accepted", code)
		}
	}
	codes := SupportedCurrencyCodes()
	if len(codes) == 0 {
		t.Fatal("empty currency catalog")
	}
	codes[0] = "invalid"
	if SupportedCurrencyCodes()[0] == "invalid" {
		t.Fatal("catalog caller mutated package state")
	}
}
