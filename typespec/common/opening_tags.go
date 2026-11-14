package common

import (
	"encoding/json"
	"regexp"
)

type OpeningTagOID string

const (
	MaxOpeningTags      = 5
	minOpeningTagOIDLen = 2
	maxOpeningTagOIDLen = 64
)

var openingTagOIDPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

func IsOpeningTagOID(value OpeningTagOID) bool {
	return len(value) >= minOpeningTagOIDLen &&
		len(value) <= maxOpeningTagOIDLen &&
		openingTagOIDPattern.MatchString(string(value))
}

type OpeningTag struct {
	TagOID         OpeningTagOID     `json:"tag_oid"`
	DisplayName    string            `json:"display_name"`
	LocalizedNames map[string]string `json:"localized_names"`
	Deprecated     bool              `json:"deprecated"`
}

func (t OpeningTag) MarshalJSON() ([]byte, error) {
	type plain OpeningTag
	if t.LocalizedNames == nil {
		t.LocalizedNames = map[string]string{}
	}
	return json.Marshal(plain(t))
}

type ListOpeningTagsRequest struct{}

func (r *ListOpeningTagsRequest) Normalize()        {}
func (r ListOpeningTagsRequest) Validate() []string { return []string{} }

type ListOpeningTagsResponse struct {
	Tags []OpeningTag `json:"tags"`
}

func (r ListOpeningTagsResponse) MarshalJSON() ([]byte, error) {
	type plain ListOpeningTagsResponse
	if r.Tags == nil {
		r.Tags = []OpeningTag{}
	}
	return json.Marshal(plain(r))
}
