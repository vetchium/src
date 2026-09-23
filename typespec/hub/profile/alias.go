package profile

import (
	"encoding/json"
	"time"

	"github.com/vetchium/src/typespec/directory"
)

type AliasState struct {
	ProfileAlias *directory.HubAlias `json:"profile_alias"`
	NextChangeAt *time.Time          `json:"next_change_at,omitempty"`
}

// AliasValue preserves the difference between an omitted property and an
// explicit null, which releases the current alias.
type AliasValue struct {
	Value   *directory.HubAlias
	Present bool
}

func (a *AliasValue) UnmarshalJSON(data []byte) error {
	a.Present = true
	if string(data) == "null" {
		a.Value = nil
		return nil
	}
	var value directory.HubAlias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	a.Value = &value
	return nil
}

func (a AliasValue) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Value)
}

type SetAliasRequest struct {
	ProfileAlias AliasValue `json:"profile_alias"`
}

func (r *SetAliasRequest) Normalize() {}

func (r SetAliasRequest) Validate() []string {
	if !r.ProfileAlias.Present ||
		(r.ProfileAlias.Value != nil &&
			!directory.IsHubAlias(*r.ProfileAlias.Value)) {
		return []string{"profile_alias"}
	}
	return []string{}
}
