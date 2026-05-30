package hub

import (
	"vetchium-api-server.typespec/common"
)

type HubApplyPreferences struct {
	NotifyConnectionsOnApply     bool `json:"notify_connections_on_apply"`
	AllowUnsolicitedEndorsements bool `json:"allow_unsolicited_endorsements"`
}

type SetNotifyConnectionsOnApplyRequest struct {
	NotifyConnectionsOnApply bool `json:"notify_connections_on_apply"`
}

type SetAllowUnsolicitedEndorsementsRequest struct {
	AllowUnsolicitedEndorsements bool `json:"allow_unsolicited_endorsements"`
}

// Validation functions
func (r *SetNotifyConnectionsOnApplyRequest) Validate() []common.ValidationError {
	return []common.ValidationError{}
}

func (r *SetAllowUnsolicitedEndorsementsRequest) Validate() []common.ValidationError {
	return []common.ValidationError{}
}
