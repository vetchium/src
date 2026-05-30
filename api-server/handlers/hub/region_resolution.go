package hub

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/server"
)

// This file centralises how hub-side handlers resolve the region that owns a
// piece of hiring data. Hub users authenticate against their own home region,
// but all hiring data (applications, candidacies, interviews, endorsements,
// references) lives in the OPENING's region — the home region of the hiring
// org (ADR-001 §1.4). A hub user in region A applying to an opening in region B
// must therefore read and write in region B, not in their own region.
//
// Three resolution strategies are used, in order of preference:
//
//  1. From an org domain  → openingRegionForDomain (one global lookup).
//  2. From a global index → e.g. applications_index / reference_nominations_index
//     (one global lookup mapping the resource id to its region).
//  3. Bounded fan-out     → hubUserHiringRegions, for candidate-owned resources
//     (candidacies, interviews, endorsements) that have no dedicated global
//     index. The candidate's hiring data is confined to the regions in which
//     they have applications, so that set (max one per region, ≤3 today) bounds
//     the search space.

// openingRegionForDomain resolves the home region of the org that owns the
// given domain. This is the region in which that org's hiring data lives.
func openingRegionForDomain(
	ctx context.Context,
	s *server.RegionalServer,
	domain string,
) (globaldb.Region, error) {
	org, err := s.Global.GetOrgByDomain(ctx, domain)
	if err != nil {
		return "", err
	}
	return org.Region, nil
}

// regionForApplication resolves the region that owns an application via the
// global applications_index (one hop). Propagates pgx.ErrNoRows when unknown.
func regionForApplication(
	ctx context.Context,
	s *server.RegionalServer,
	applicationID pgtype.UUID,
) (globaldb.Region, error) {
	idx, err := s.Global.GetApplicationIndexEntry(ctx, applicationID)
	if err != nil {
		return "", err
	}
	return globaldb.Region(idx.Region), nil
}

// allConfiguredRegions returns every region this server can reach. Used as a
// last-resort bounded fan-out (≤3 regions) for resources keyed only by an id
// with no global index and no candidate-application anchor — e.g. an endorser
// editing their endorsement, where the endorser may not be an applicant
// anywhere (so applications_index gives no anchor).
func allConfiguredRegions(s *server.RegionalServer) []globaldb.Region {
	regions := make([]globaldb.Region, 0, len(s.AllRegionalDBs))
	for region := range s.AllRegionalDBs {
		regions = append(regions, region)
	}
	return regions
}

// regionForReferenceNomination resolves the region that owns a reference
// nomination via the global reference_nominations_index (one hop). A reference
// nominee is typically not an applicant anywhere, so their nominations cannot
// be found via applications_index — this index is the only route.
func regionForReferenceNomination(
	ctx context.Context,
	s *server.RegionalServer,
	nominationID pgtype.UUID,
) (globaldb.Region, error) {
	idx, err := s.Global.GetReferenceNominationIndexEntry(ctx, nominationID)
	if err != nil {
		return "", err
	}
	return globaldb.Region(idx.Region), nil
}

// referenceNomineeRegions returns the distinct regions in which the hub user
// has been nominated as a reference (across all candidates who nominated them).
func referenceNomineeRegions(
	ctx context.Context,
	s *server.RegionalServer,
	nomineeID pgtype.UUID,
) ([]globaldb.Region, error) {
	rows, err := s.Global.GetDistinctRegionsByReferenceNominee(ctx, nomineeID)
	if err != nil {
		return nil, err
	}
	regions := make([]globaldb.Region, 0, len(rows))
	for _, r := range rows {
		regions = append(regions, globaldb.Region(r))
	}
	return regions, nil
}

// hubUserHiringRegions returns the distinct set of regions in which the hub
// user has hiring data. It bounds the search space for by-id lookups and list
// fan-outs over candidate-owned resources that lack a dedicated global index.
func hubUserHiringRegions(
	ctx context.Context,
	s *server.RegionalServer,
	hubUserID pgtype.UUID,
) ([]globaldb.Region, error) {
	rows, err := s.Global.GetDistinctRegionsByHubUser(ctx, hubUserID)
	if err != nil {
		return nil, err
	}
	regions := make([]globaldb.Region, 0, len(rows))
	for _, r := range rows {
		regions = append(regions, globaldb.Region(r))
	}
	return regions, nil
}
