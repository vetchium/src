// Package company contains Admin API company-setting wire types.
package company

import (
	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/common"
)

type CompanyRegionalDefaultsResponse struct {
	DefaultLanguage admincommon.LanguageCode `json:"default_language"`
	DefaultTimezone common.TimeZoneID        `json:"default_timezone"`
}

type SetCompanyRegionalDefaultsRequest struct {
	DefaultLanguage admincommon.LanguageCode `json:"default_language"`
	DefaultTimezone common.TimeZoneID        `json:"default_timezone"`
}

func (r SetCompanyRegionalDefaultsRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !admincommon.IsLanguageCode(r.DefaultLanguage) {
		fields = append(fields, "default_language")
	}
	if !common.IsTimeZoneID(r.DefaultTimezone) {
		fields = append(fields, "default_timezone")
	}
	return fields
}
