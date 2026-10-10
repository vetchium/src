package common

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed currency_catalog.json
var currencyCatalogJSON []byte

type CurrencyCode string

var currencyCatalog = func() []CurrencyCode {
	var codes []CurrencyCode
	if err := json.Unmarshal(currencyCatalogJSON, &codes); err != nil {
		panic(fmt.Sprintf("invalid embedded currency catalog: %v", err))
	}
	return codes
}()

var currencyCatalogSet = func() map[CurrencyCode]struct{} {
	set := make(map[CurrencyCode]struct{}, len(currencyCatalog))
	for _, code := range currencyCatalog {
		set[code] = struct{}{}
	}
	return set
}()

func SupportedCurrencyCodes() []CurrencyCode {
	return append([]CurrencyCode(nil), currencyCatalog...)
}

func IsCurrencyCode(value CurrencyCode) bool {
	_, ok := currencyCatalogSet[value]
	return ok
}
