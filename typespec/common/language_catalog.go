package common

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed language_catalog.json
var languageCatalogJSON []byte

type LanguageTag string

var languageCatalog = func() []LanguageTag {
	var tags []LanguageTag
	if err := json.Unmarshal(languageCatalogJSON, &tags); err != nil {
		panic(fmt.Sprintf("invalid embedded language catalog: %v", err))
	}
	return tags
}()

var languageCatalogSet = func() map[LanguageTag]struct{} {
	set := make(map[LanguageTag]struct{}, len(languageCatalog))
	for _, tag := range languageCatalog {
		set[tag] = struct{}{}
	}
	return set
}()

func SupportedLanguageTags() []LanguageTag {
	return append([]LanguageTag(nil), languageCatalog...)
}

func IsLanguageTag(value LanguageTag) bool {
	_, ok := languageCatalogSet[value]
	return ok
}
