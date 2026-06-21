package org

import (
	"vetchium-api-server.typespec/common"
)

type ExtendOfferRequest struct {
	CandidacyID string  `json:"candidacy_id"`
	StartDate   *string `json:"start_date,omitempty"`
	Notes       *string `json:"notes,omitempty"`
}

// Validation function
func (r *ExtendOfferRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CandidacyID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "candidacy_id",
			Message: "is required",
		})
	}

	if r.Notes != nil && len(*r.Notes) > 4000 {
		errs = append(errs, common.ValidationError{
			Field:   "notes",
			Message: "must be at most 4000 characters",
		})
	}

	return errs
}

type ExtendOfferResponse struct {
	CandidacyID string `json:"candidacy_id"`
	ExtendedAt  string `json:"extended_at"`
}
