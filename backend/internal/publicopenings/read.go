// Package publicopenings builds the public Opening representation at an
// Org's home tenant for both local Hub reads and mesh peer reads.
package publicopenings

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/db/sqlc"
)

var ErrOrgNotFound = errors.New("public Org not found")
var ErrOpeningNotFound = errors.New("public Opening not found")
var ErrInvalidPaginationKey = errors.New("invalid public Opening pagination key")

type Queries interface {
	ListPublicOrgOpenings(
		context.Context, sqlc.ListPublicOrgOpeningsParams,
	) (sqlc.ListPublicOrgOpeningsRow, error)
	GetPublicOrgOpening(
		context.Context, sqlc.GetPublicOrgOpeningParams,
	) (sqlc.GetPublicOrgOpeningRow, error)
}

type LogoSigner interface {
	SignLogoGet(context.Context, pgtype.UUID) (string, error)
}

type Reader struct {
	Queries Queries
	Logos   LogoSigner
}

type cursor struct {
	Domain           orgs.OrgDomain `json:"domain"`
	EmployingCountry string         `json:"employing_country"`
	WorkArrangement  string         `json:"work_arrangement"`
	EmploymentType   string         `json:"employment_type"`
	TitleQuery       string         `json:"title_query"`
	At               time.Time      `json:"at"`
	Number           int32          `json:"number"`
}

func cursorFor(request openingsspec.ListOrgOpeningsRequest) cursor {
	c := cursor{Domain: request.Domain}
	if request.EmployingCountry != nil {
		c.EmployingCountry = string(*request.EmployingCountry)
	}
	if request.WorkArrangement != nil {
		c.WorkArrangement = string(*request.WorkArrangement)
	}
	if request.EmploymentType != nil {
		c.EmploymentType = string(*request.EmploymentType)
	}
	if request.TitleQuery != nil {
		c.TitleQuery = strings.ToLower(string(*request.TitleQuery))
	}
	return c
}

func parseCursor(request openingsspec.ListOrgOpeningsRequest) (cursor, error) {
	expected := cursorFor(request)
	if request.PaginationKey == nil {
		return expected, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(string(*request.PaginationKey))
	if err != nil {
		return cursor{}, ErrInvalidPaginationKey
	}
	var actual cursor
	if err := json.Unmarshal(data, &actual); err != nil || actual.At.IsZero() ||
		actual.Number < 1 || actual.Domain != expected.Domain ||
		actual.EmployingCountry != expected.EmployingCountry ||
		actual.WorkArrangement != expected.WorkArrangement ||
		actual.EmploymentType != expected.EmploymentType ||
		actual.TitleQuery != expected.TitleQuery {
		return cursor{}, ErrInvalidPaginationKey
	}
	return actual, nil
}

func textParam(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func (r Reader) publicOrg(
	ctx context.Context, domain orgs.OrgDomain, displayName, country string,
	logoID pgtype.UUID,
) (openingsspec.PublicOrg, error) {
	org := openingsspec.PublicOrg{
		Domain: domain, DisplayName: common.DisplayName(displayName),
		Country: common.CountryCode(country),
	}
	if logoID.Valid {
		if r.Logos == nil {
			return org, fmt.Errorf("org logo signer unavailable")
		}
		url, err := r.Logos.SignLogoGet(ctx, logoID)
		if err != nil {
			return org, fmt.Errorf("sign Org logo: %w", err)
		}
		org.LogoURL = &url
	}
	return org, nil
}

func (r Reader) List(
	ctx context.Context, request openingsspec.ListOrgOpeningsRequest,
) (openingsspec.ListOrgOpeningsResponse, error) {
	c, err := parseCursor(request)
	if err != nil {
		return openingsspec.ListOrgOpeningsResponse{}, err
	}
	var cursorAt pgtype.Timestamptz
	var cursorNumber pgtype.Int4
	if !c.At.IsZero() {
		cursorAt = pgtype.Timestamptz{Time: c.At, Valid: true}
		cursorNumber = pgtype.Int4{Int32: c.Number, Valid: true}
	}
	var country, arrangement, employment, title *string
	if request.EmployingCountry != nil {
		value := string(*request.EmployingCountry)
		country = &value
	}
	if request.WorkArrangement != nil {
		value := string(*request.WorkArrangement)
		arrangement = &value
	}
	if request.EmploymentType != nil {
		value := string(*request.EmploymentType)
		employment = &value
	}
	if request.TitleQuery != nil {
		value := string(*request.TitleQuery)
		title = &value
	}
	row, err := r.Queries.ListPublicOrgOpenings(
		ctx, sqlc.ListPublicOrgOpeningsParams{
			Domain:           string(request.Domain),
			EmployingCountry: textParam(country),
			WorkArrangement:  textParam(arrangement),
			EmploymentType:   textParam(employment),
			TitleQuery:       textParam(title),
			CursorAt:         cursorAt, CursorNumber: cursorNumber,
			PageSize: request.EffectiveLimit() + 1,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return openingsspec.ListOrgOpeningsResponse{}, ErrOrgNotFound
	}
	if err != nil {
		return openingsspec.ListOrgOpeningsResponse{}, err
	}
	org, err := r.publicOrg(ctx, request.Domain, row.DisplayName, row.Country, row.LogoObjectID)
	if err != nil {
		return openingsspec.ListOrgOpeningsResponse{}, err
	}
	response := openingsspec.ListOrgOpeningsResponse{Org: org}
	if err := json.Unmarshal(row.Openings, &response.Openings); err != nil {
		return openingsspec.ListOrgOpeningsResponse{}, fmt.Errorf("decode public Opening list: %w", err)
	}
	if len(response.Openings) > int(request.EffectiveLimit()) {
		response.Openings = response.Openings[:request.EffectiveLimit()]
		last := response.Openings[len(response.Openings)-1]
		c.At, c.Number = last.FirstPublishedAt, int32(last.OpeningNumber)
		data, err := json.Marshal(c)
		if err != nil {
			return openingsspec.ListOrgOpeningsResponse{}, err
		}
		key := common.PaginationKey(base64.RawURLEncoding.EncodeToString(data))
		response.NextPaginationKey = &key
	}
	return response, nil
}

func (r Reader) Get(
	ctx context.Context, request openingsspec.GetOrgOpeningRequest,
) (openingsspec.GetOrgOpeningResponse, error) {
	row, err := r.Queries.GetPublicOrgOpening(
		ctx, sqlc.GetPublicOrgOpeningParams{
			Domain:        string(request.Domain),
			OpeningNumber: int32(request.OpeningNumber),
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return openingsspec.GetOrgOpeningResponse{}, ErrOrgNotFound
	}
	if err != nil {
		return openingsspec.GetOrgOpeningResponse{}, err
	}
	var opening *openingsspec.PublicOpening
	if err := json.Unmarshal([]byte(row.OpeningJson), &opening); err != nil {
		return openingsspec.GetOrgOpeningResponse{}, fmt.Errorf("decode public Opening: %w", err)
	}
	if opening == nil {
		return openingsspec.GetOrgOpeningResponse{}, ErrOpeningNotFound
	}
	org, err := r.publicOrg(ctx, request.Domain, row.DisplayName, row.Country, row.LogoObjectID)
	if err != nil {
		return openingsspec.GetOrgOpeningResponse{}, err
	}
	return openingsspec.GetOrgOpeningResponse{Org: org, Opening: *opening}, nil
}
