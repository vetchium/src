package openings

import (
	"encoding/json"
	"fmt"

	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"
)

// unknownTags turns the statement's catalog misses into the refusal, or nil
// when every tag is in the catalog (OPN-TAG-008).
func unknownTags(encoded []byte) (*orgsproblem.OpeningTagUnknownDetails, error) {
	var oids []string
	if err := json.Unmarshal(encoded, &oids); err != nil {
		return nil, fmt.Errorf("decode unknown Opening tags: %w", err)
	}
	if len(oids) == 0 {
		return nil, nil
	}
	details := orgsproblem.OpeningTagUnknownError(oids)
	return &details, nil
}
