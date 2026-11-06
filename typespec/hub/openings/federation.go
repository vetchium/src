package openings

import "github.com/vetchium/src/typespec/orgs"

type RelayListOrgOpeningsRequest = ListOrgOpeningsRequest
type RelayGetOrgOpeningRequest = GetOrgOpeningRequest
type PeerListOrgOpeningsRequest = ListOrgOpeningsRequest
type PeerGetOrgOpeningRequest = GetOrgOpeningRequest

type MeshListOpeningAgenciesRequest = GetOrgOpeningRequest

// MeshOpeningAgency is an agency with an active sourcing engagement assigned
// to the Opening, as the consumer's tenant recorded it. Mesh-only: the Hub
// never returns the DID.
type MeshOpeningAgency struct {
	AgencyOrgDID      orgs.OrgDID    `json:"agency_org_did"`
	AgencyDomain      orgs.OrgDomain `json:"agency_domain"`
	AgencyDisplayName string         `json:"agency_display_name"`
}

// MeshListOpeningAgenciesResponse lists the agencies assigned to a published
// Opening (MKT-DAT-014).
type MeshListOpeningAgenciesResponse struct {
	Items []MeshOpeningAgency `json:"items"`
}
