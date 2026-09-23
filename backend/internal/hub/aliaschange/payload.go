package aliaschange

import (
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
)

// Payload is the replayable local operation, including the profile state that
// authorized dispatch. The global command is derived from it and a stable
// command ID; the expected version prevents a late claim after a downgrade.
type Payload struct {
	HubUserDID             hubspec.HubUserDID      `json:"hub_user_did"`
	ProfileAlias           *directoryspec.HubAlias `json:"profile_alias"`
	PreviousAlias          *directoryspec.HubAlias `json:"previous_alias"`
	ExpectedProfileVersion int64                   `json:"expected_profile_version"`
}

func (p Payload) Valid() bool {
	if !hubspec.IsHubUserDID(p.HubUserDID) || p.ExpectedProfileVersion < 1 {
		return false
	}
	if p.ProfileAlias != nil && !directoryspec.IsHubAlias(*p.ProfileAlias) ||
		p.PreviousAlias != nil && !directoryspec.IsHubAlias(*p.PreviousAlias) {
		return false
	}
	if p.ProfileAlias == nil || p.PreviousAlias == nil {
		return p.ProfileAlias != p.PreviousAlias
	}
	return *p.ProfileAlias != *p.PreviousAlias
}
