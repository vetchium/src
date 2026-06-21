package org

import (
	"vetchium-api-server.typespec/common"
	hub "vetchium-api-server.typespec/hub"
)

type OrgGetHubUserProfileRequest struct {
	Handle string `json:"handle"`
}

type OrgHubUserProfileResponse struct {
	Profile hub.HubProfilePublicView  `json:"profile"`
	Stints  []hub.PublicEmployerStint `json:"stints"`
}

func (r OrgGetHubUserProfileRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Handle == "" {
		errs = append(errs, common.ValidationError{
			Field:   "handle",
			Message: "Handle is required",
		})
	}
	return errs
}
