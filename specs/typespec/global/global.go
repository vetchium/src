package global

import (
	"vetchium-api-server.typespec/common"
)

// Structs
type Region struct {
	RegionCode string `json:"region_code"`
	RegionName string `json:"region_name"`
}

type SupportedLanguage struct {
	LanguageCode string `json:"language_code"`
	LanguageName string `json:"language_name"`
	NativeName   string `json:"native_name"`
	IsDefault    bool   `json:"is_default"`
}

type CheckDomainRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r CheckDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type CheckDomainResponse struct {
	IsApproved bool `json:"is_approved"`
}

type GetRegionsResponse struct {
	Regions []Region `json:"regions"`
}

type GetSupportedLanguagesResponse struct {
	Languages []SupportedLanguage `json:"languages"`
}
