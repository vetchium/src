package applications

import "github.com/vetchium/src/typespec/hub"

// MeshGetApplicationRequest is the applicant's live read across the mesh;
// the Org's tenant answers only for an applicant homed at the caller.
type MeshGetApplicationRequest struct {
	ApplicationReference
	ApplicantDID hub.HubUserDID `json:"applicant_did"`
}

func (r *MeshGetApplicationRequest) Normalize() {
	r.ApplicationReference.Normalize()
}

func (r MeshGetApplicationRequest) Validate() []string {
	fields := r.ApplicationReference.Validate()
	if !hub.IsHubUserDID(r.ApplicantDID) {
		fields = append(fields, "applicant_did")
	}
	return fields
}
