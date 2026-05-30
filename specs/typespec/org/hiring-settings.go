package org

import (
	"vetchium-api-server.typespec/common"
)

type OrgHiringSettings struct {
	CoolOffDays                         int32 `json:"cool_off_days"`
	AllowUnsolicitedEndorsementsDefault bool  `json:"allow_unsolicited_endorsements_default"`
}

type UpdateOrgHiringSettingsRequest struct {
	CoolOffDays                         int32 `json:"cool_off_days"`
	AllowUnsolicitedEndorsementsDefault *bool `json:"allow_unsolicited_endorsements_default,omitempty"`
}

// Validation functions
func (r *UpdateOrgHiringSettingsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CoolOffDays < 0 || r.CoolOffDays > 365 {
		errs = append(errs, common.ValidationError{
			Field:   "cool_off_days",
			Message: "must be between 0 and 365",
		})
	}

	return errs
}
