package settings

import "github.com/vetchium/src/typespec/common"

type SetCompanyNameRequest struct {
	DisplayName common.DisplayName `json:"display_name"`
}

func (r *SetCompanyNameRequest) Normalize() {
	r.DisplayName = common.NormalizeDisplayName(r.DisplayName)
}
func (r SetCompanyNameRequest) Validate() []string {
	if !common.IsDisplayName(r.DisplayName) {
		return []string{"display_name"}
	}
	return []string{}
}
