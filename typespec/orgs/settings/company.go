package settings

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

type SetCompanyDetailsRequest struct {
	DisplayName     common.DisplayName  `json:"display_name"`
	Country         common.CountryCode  `json:"country"`
	DefaultLanguage orgs.FrontendLocale `json:"default_language"`
}

func (r *SetCompanyDetailsRequest) Normalize() {
	r.DisplayName = common.NormalizeDisplayName(r.DisplayName)
}
func (r SetCompanyDetailsRequest) Validate() []string {
	fields := make([]string, 0, 3)
	if !common.IsDisplayName(r.DisplayName) {
		fields = append(fields, "display_name")
	}
	if !common.IsCountryCode(r.Country) {
		fields = append(fields, "country")
	}
	if !orgs.IsFrontendLocale(r.DefaultLanguage) {
		fields = append(fields, "default_language")
	}
	return fields
}
