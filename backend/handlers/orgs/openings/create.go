package openings

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/openings"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	"backend/internal/orgs/entitlements"
)

// newStageIDs returns an id for every position a pipeline may use; the
// statement takes the first ones it needs.
func newStageIDs(now time.Time) ([]pgtype.UUID, error) {
	ids := make([]pgtype.UUID, hiring.MaxPipelineStages)
	for index := range ids {
		id, err := dbvalue.NewUUIDv7(now)
		if err != nil {
			return nil, err
		}
		ids[index] = id
	}
	return ids, nil
}

func optionalTemplate(value *hiring.PipelineTemplateID) (pgtype.UUID, error) {
	if value == nil {
		return pgtype.UUID{}, nil
	}
	return dbvalue.ParseUUID(string(*value))
}

func CreateOpening(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.CreateOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[openings.OrgOpening]
		handlerauth.RunIdempotent(
			s, w, r, "orgs:create-opening", dbvalue.FormatUUID(identity.UserID),
			key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				policy, err := q.LockOrgOpeningPolicy(r.Context(), identity.OrgDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OrgSuspendedError)
				}
				if err != nil {
					return result{}, nil, err
				}
				// A new Opening starts from the Org's default language and
				// country. The country is left unset when it would contradict a
				// remote country list the caller already chose.
				if request.Content.Language == nil {
					language := common.LanguageTag(strings.SplitN(string(policy.DefaultLanguage), "-", 2)[0])
					request.Content.Language = &language
				}
				country := common.CountryCode(policy.Country)
				if remote := request.Content.RemoteEligibility; request.Content.EmployingCountry == nil &&
					(remote == nil || len(remote.Countries) == 0 || slices.Contains(remote.Countries, country)) {
					request.Content.EmployingCountry = &country
				}
				openingID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				stageIDs, err := newStageIDs(now)
				if err != nil {
					return result{}, nil, err
				}
				templateID, err := optionalTemplate(request.PipelineTemplateID)
				if err != nil {
					return result{}, nil, err
				}
				content, err := json.Marshal(request.Content)
				if err != nil {
					return result{}, nil, err
				}
				team := make([]string, len(request.TeamMemberEmails))
				for index, email := range request.TeamMemberEmails {
					team[index] = string(email)
				}
				quota := int32(entitlements.OpeningQuota(
					subscriptionspec.PlanOID(policy.OrgPlanOid),
				))
				row, err := q.CreateOrgOpening(r.Context(), sqlc.CreateOrgOpeningParams{
					OrgDid:             identity.OrgDID,
					WindowStart:        dbvalue.Timestamp(entitlements.WindowStart(now)),
					HiringManagerEmail: optionalEmail(request.HiringManagerEmail),
					RecruiterEmail:     optionalEmail(request.RecruiterEmail),
					TeamMemberEmails:   team,
					TemplateID:         templateID,
					StageIds:           stageIDs,
					Quota:              quota,
					OpeningID:          openingID,
					InternalNotes:      dbvalue.NullText(request.InternalNotes),
					ActorID:            identity.UserID,
					Content:            content,
					HistoryID:          historyID,
					TenantID:           s.TenantID,
					IdempotencyKey:     dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				var invalid []string
				if err := json.Unmarshal(row.InvalidAddresses, &invalid); err != nil {
					return result{}, nil, fmt.Errorf("decode invalid hiring team: %w", err)
				}
				if len(invalid) > 0 {
					return handlerauth.Failure[openings.OrgOpening](
						orgsproblem.OpeningHiringTeamInvalidError(invalid),
					)
				}
				if row.TemplateMissing {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.PipelineTemplateNotFoundError)
				}
				if row.OpeningNumber == 0 {
					return handlerauth.Failure[openings.OrgOpening](
						orgsproblem.OpeningsQuotaExceededError(quota, row.Used),
					)
				}
				if row.ContentRows != 1 || row.HistoryRows != 1 ||
					row.AuditRows != 1 || row.TeamRows != int64(len(team)) ||
					row.StageRows < 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening creation")
				}
				created, err := loadOpening(
					r.Context(), q, identity, openings.OpeningNumber(row.OpeningNumber),
				)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusCreated, Body: created}, nil, nil
			},
		)
	}
}

func DuplicateOpening(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.DuplicateOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[openings.OrgOpening]
		handlerauth.RunIdempotent(
			s, w, r, "orgs:duplicate-opening", dbvalue.FormatUUID(identity.UserID),
			key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				policy, err := q.LockOrgOpeningPolicy(r.Context(), identity.OrgDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OrgSuspendedError)
				}
				if err != nil {
					return result{}, nil, err
				}
				openingID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				quota := int32(entitlements.OpeningQuota(
					subscriptionspec.PlanOID(policy.OrgPlanOid),
				))
				stageIDs, err := newStageIDs(now)
				if err != nil {
					return result{}, nil, err
				}
				templateID, err := optionalTemplate(request.PipelineTemplateID)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.DuplicateOrgOpening(r.Context(), sqlc.DuplicateOrgOpeningParams{
					TemplateID:      templateID,
					StageIds:        stageIDs,
					OrgDid:          identity.OrgDID,
					DuplicateNumber: int32(request.OpeningNumber),
					WindowStart:     dbvalue.Timestamp(entitlements.WindowStart(now)),
					Quota:           quota,
					OpeningID:       openingID,
					ActorID:         identity.UserID,
					HistoryID:       historyID,
					TenantID:        s.TenantID,
					IdempotencyKey:  dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.SourceState == "" {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
				}
				if row.SourceState == string(openings.Discarded) {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningStateConflictError)
				}
				if row.TemplateMissing {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.PipelineTemplateNotFoundError)
				}
				if row.OpeningNumber == 0 {
					return handlerauth.Failure[openings.OrgOpening](
						orgsproblem.OpeningsQuotaExceededError(quota, row.Used),
					)
				}
				if row.ContentRows != 1 || row.HistoryRows != 1 || row.AuditRows != 1 ||
					row.StageRows < 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening duplication")
				}
				created, err := loadOpening(
					r.Context(), q, identity, openings.OpeningNumber(row.OpeningNumber),
				)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusCreated, Body: created}, nil, nil
			},
		)
	}
}
