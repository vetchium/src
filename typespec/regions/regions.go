package regions

import "github.com/vetchium/src/typespec/common"

type ListSignupRegionsRequest struct {
	ResidentCountry common.CountryCode    `json:"resident_country"`
	PaginationKey   *common.PaginationKey `json:"pagination_key,omitempty"`
}

func (r *ListSignupRegionsRequest) Normalize() {}
func (r ListSignupRegionsRequest) Validate() []string {
	fields := []string{}
	if !common.IsCountryCode(r.ResidentCountry) {
		fields = append(fields, "resident_country")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	return fields
}

type SignupRegion struct {
	TenantID       string             `json:"tenant_id"`
	HostingCountry common.CountryCode `json:"hosting_country"`
	HubURL         string             `json:"hub_url"`
	Recommended    bool               `json:"recommended"`
}
type ListSignupRegionsResponse struct {
	CatalogVersion    string                `json:"catalog_version"`
	Regions           []SignupRegion        `json:"regions"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key"`
}
