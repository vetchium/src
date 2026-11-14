// Package openingsearch builds Opening search results at the answering
// tenant for both local Hub reads and mesh peer reads (OPN-SRCH-002).
package openingsearch

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/publicopenings"
)

var ErrInvalidPaginationKey = errors.New("invalid Opening search pagination key")

type Queries interface {
	SearchOpenings(
		context.Context, sqlc.SearchOpeningsParams,
	) ([]sqlc.SearchOpeningsRow, error)
	SuggestOpeningOrgs(
		context.Context, sqlc.SuggestOpeningOrgsParams,
	) ([]sqlc.SuggestOpeningOrgsRow, error)
}

type Reader struct {
	Queries  Queries
	Logos    publicopenings.LogoSigner
	TenantID directory.TenantID
}

// filters is the normalized query a pagination key binds (OPN-SRCH-005).
type filters struct {
	Keyword          string   `json:"keyword,omitempty"`
	OrgDomain        string   `json:"org_domain,omitempty"`
	TagOIDs          []string `json:"tag_oids,omitempty"`
	WorkCountries    []string `json:"work_countries,omitempty"`
	WorkArrangements []string `json:"work_arrangements,omitempty"`
	EmploymentTypes  []string `json:"employment_types,omitempty"`
	PostedWithinDays *int32   `json:"posted_within_days,omitempty"`
	ExperienceYears  *int32   `json:"experience_years,omitempty"`
	EducationLevel   string   `json:"education_level,omitempty"`
	SalaryDisclosed  bool     `json:"salary_disclosed,omitempty"`
}

// cursor binds the ideal-job text only by digest, so a key never carries the
// text itself (OPN-SRCH-005).
type cursor struct {
	TenantID       directory.TenantID             `json:"tenant_id"`
	Filters        filters                        `json:"filters"`
	Sort           openingsspec.OpeningSearchSort `json:"sort"`
	IdealJobDigest string                         `json:"ideal_job_digest,omitempty"`
	Rank           float32                        `json:"rank"`
	MatchedTags    int32                          `json:"matched_tags"`
	At             time.Time                      `json:"at"`
	Domain         string                         `json:"domain"`
	Number         int32                          `json:"number"`
}

func sortedStrings[T ~string](items []T) []string {
	if items == nil {
		return nil
	}
	values := make([]string, len(items))
	for i, item := range items {
		values[i] = string(item)
	}
	slices.Sort(values)
	return values
}

func filtersFor(query openingsspec.OpeningSearchQuery) filters {
	f := filters{
		TagOIDs:          sortedStrings(query.TagOIDs),
		WorkCountries:    sortedStrings(query.WorkCountries),
		WorkArrangements: sortedStrings(query.WorkArrangements),
		EmploymentTypes:  sortedStrings(query.EmploymentTypes),
		SalaryDisclosed:  query.SalaryDisclosed != nil && *query.SalaryDisclosed,
	}
	if query.Keyword != nil {
		f.Keyword = strings.ToLower(string(*query.Keyword))
	}
	if query.OrgDomain != nil {
		f.OrgDomain = string(*query.OrgDomain)
	}
	if query.PostedWithinDays != nil {
		days := int32(*query.PostedWithinDays)
		f.PostedWithinDays = &days
	}
	if query.ExperienceYears != nil {
		years := int32(*query.ExperienceYears)
		f.ExperienceYears = &years
	}
	if query.EducationLevel != nil {
		f.EducationLevel = string(*query.EducationLevel)
	}
	return f
}

// idealJobText is the text to match under the match sort, and nil otherwise.
func idealJobText(query openingsspec.OpeningSearchQuery) *string {
	if query.EffectiveSort() != openingsspec.SortIdealJobMatch || query.IdealJobText == nil {
		return nil
	}
	text := string(*query.IdealJobText)
	return &text
}

func (r Reader) parseCursor(query openingsspec.OpeningSearchQuery) (cursor, error) {
	expected := cursor{
		TenantID: r.TenantID, Filters: filtersFor(query), Sort: query.EffectiveSort(),
	}
	if text := idealJobText(query); text != nil {
		digest := sha256.Sum256([]byte(*text))
		expected.IdealJobDigest = hex.EncodeToString(digest[:])
	}
	if query.PaginationKey == nil {
		return expected, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(string(*query.PaginationKey))
	if err != nil {
		return cursor{}, ErrInvalidPaginationKey
	}
	var actual cursor
	if err := json.Unmarshal(data, &actual); err != nil || actual.At.IsZero() ||
		actual.Number < 1 || actual.Domain == "" || actual.MatchedTags < 0 ||
		actual.Rank < 0 || actual.TenantID != expected.TenantID ||
		actual.Sort != expected.Sort || actual.IdealJobDigest != expected.IdealJobDigest ||
		!reflect.DeepEqual(actual.Filters, expected.Filters) {
		return cursor{}, ErrInvalidPaginationKey
	}
	return actual, nil
}

func textParam(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: value != ""}
}

// keywordParam sends the keyword as given; PostgreSQL lower() does the
// case folding, which can differ from the Go folding the key binds.
func keywordParam(keyword *openingsspec.OpeningSearchKeyword) pgtype.Text {
	if keyword == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: string(*keyword), Valid: true}
}

func int4Param(value *int32) pgtype.Int4 {
	if value == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *value, Valid: true}
}

// logoURLs signs each distinct logo once per call (OPN-SRCH-006).
type logoURLs struct {
	signer publicopenings.LogoSigner
	signed map[[16]byte]string
}

func (l *logoURLs) publicOrg(
	ctx context.Context, domain, displayName, country string, logoID pgtype.UUID,
) (openingsspec.PublicOrg, error) {
	org := openingsspec.PublicOrg{
		Domain: orgs.OrgDomain(domain), DisplayName: common.DisplayName(displayName),
		Country: common.CountryCode(country),
	}
	if !logoID.Valid {
		return org, nil
	}
	url, ok := l.signed[logoID.Bytes]
	if !ok {
		if l.signer == nil {
			return org, fmt.Errorf("org logo signer unavailable")
		}
		var err error
		url, err = l.signer.SignLogoGet(ctx, logoID)
		if err != nil {
			return org, fmt.Errorf("sign Org logo: %w", err)
		}
		l.signed[logoID.Bytes] = url
	}
	org.LogoURL = &url
	return org, nil
}

// Search answers one Opening search from the local database. It never logs
// the query or the ideal-job text (OPN-SRCH-008).
func (r Reader) Search(
	ctx context.Context, query openingsspec.OpeningSearchQuery,
) (openingsspec.SearchOpeningsResponse, error) {
	c, err := r.parseCursor(query)
	if err != nil {
		return openingsspec.SearchOpeningsResponse{}, err
	}
	f := c.Filters
	params := sqlc.SearchOpeningsParams{
		TagOids:          f.TagOIDs,
		Keyword:          keywordParam(query.Keyword),
		OrgDomain:        textParam(f.OrgDomain),
		WorkCountries:    f.WorkCountries,
		WorkArrangements: f.WorkArrangements,
		EmploymentTypes:  f.EmploymentTypes,
		PostedWithinDays: int4Param(f.PostedWithinDays),
		ExperienceYears:  int4Param(f.ExperienceYears),
		EducationLevel:   textParam(f.EducationLevel),
		SalaryDisclosed:  f.SalaryDisclosed,
		PageSize:         query.EffectiveLimit() + 1,
	}
	if text := idealJobText(query); text != nil {
		params.IdealJobText = pgtype.Text{String: *text, Valid: true}
	}
	if !c.At.IsZero() {
		params.CursorAt = pgtype.Timestamptz{Time: c.At, Valid: true}
		params.CursorRank = pgtype.Float4{Float32: c.Rank, Valid: true}
		params.CursorMatchedTags = pgtype.Int4{Int32: c.MatchedTags, Valid: true}
		params.CursorDomain = pgtype.Text{String: c.Domain, Valid: true}
		params.CursorNumber = pgtype.Int4{Int32: c.Number, Valid: true}
	}
	rows, err := r.Queries.SearchOpenings(ctx, params)
	if err != nil {
		return openingsspec.SearchOpeningsResponse{}, err
	}
	more := len(rows) > int(query.EffectiveLimit())
	if more {
		rows = rows[:query.EffectiveLimit()]
	}
	logos := logoURLs{signer: r.Logos, signed: map[[16]byte]string{}}
	response := openingsspec.SearchOpeningsResponse{
		Openings: make([]openingsspec.OpeningSearchResult, 0, len(rows)),
	}
	for _, row := range rows {
		org, err := logos.publicOrg(ctx, row.Domain, row.DisplayName, row.Country, row.LogoObjectID)
		if err != nil {
			return openingsspec.SearchOpeningsResponse{}, err
		}
		result := openingsspec.OpeningSearchResult{Org: org}
		if err := json.Unmarshal(row.Summary, &result.Opening); err != nil {
			return openingsspec.SearchOpeningsResponse{}, fmt.Errorf("decode Opening search summary: %w", err)
		}
		response.Openings = append(response.Openings, result)
	}
	if more {
		last := rows[len(rows)-1]
		lastOpening := response.Openings[len(response.Openings)-1].Opening
		c.Rank, c.MatchedTags, c.Domain = last.Rank, last.MatchedTags, last.Domain
		c.At, c.Number = lastOpening.FirstPublishedAt, int32(lastOpening.OpeningNumber)
		data, err := json.Marshal(c)
		if err != nil {
			return openingsspec.SearchOpeningsResponse{}, err
		}
		key := common.PaginationKey(base64.RawURLEncoding.EncodeToString(data))
		response.NextPaginationKey = &key
	}
	return response, nil
}

// SuggestOrgs lists the local Orgs an Opening search could return whose name
// or domain matches the query (OPN-SRCH-007). It never logs the query.
func (r Reader) SuggestOrgs(
	ctx context.Context, query openingsspec.SuggestOpeningOrgsQuery,
) (openingsspec.SuggestOpeningOrgsResponse, error) {
	rows, err := r.Queries.SuggestOpeningOrgs(ctx, sqlc.SuggestOpeningOrgsParams{
		Query: string(query.Query), MaxOrgs: openingsspec.MaxOpeningOrgSuggestions,
	})
	if err != nil {
		return openingsspec.SuggestOpeningOrgsResponse{}, err
	}
	logos := logoURLs{signer: r.Logos, signed: map[[16]byte]string{}}
	response := openingsspec.SuggestOpeningOrgsResponse{
		Orgs: make([]openingsspec.PublicOrg, 0, len(rows)),
	}
	for _, row := range rows {
		org, err := logos.publicOrg(ctx, row.Domain, row.DisplayName, row.Country, row.LogoObjectID)
		if err != nil {
			return openingsspec.SuggestOpeningOrgsResponse{}, err
		}
		response.Orgs = append(response.Orgs, org)
	}
	return response, nil
}
