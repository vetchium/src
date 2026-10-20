package applications

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

// pendingStageOf refuses a candidacy that is not in_pipeline at a pending
// stage of the kind: the stage's result is recorded there, once.
func pendingStageOf(
	kind sqlc.VetchiumPipelineStageKind,
) func(sqlc.LockOrgApplicationForWriteRow, time.Time) problem.Body {
	return func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
		if details := stateConflict(
			sqlc.VetchiumOrgApplicationStateInPipeline,
		)(locked.ApplicationState); details != nil {
			return details
		}
		if locked.CurrentStageKind.VetchiumPipelineStageKind != kind ||
			locked.CurrentStageStatus != string(applications.StagePending) {
			return orgsproblem.ApplicationStateConflictError
		}
		return nil
	}
}

func optionalNotes(notes *applications.ResultNotes) pgtype.Text {
	if notes == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*notes))
}

func optionalReportURL(link *profile.WebsiteURL) pgtype.Text {
	return optionalURL(link)
}

func optionalScore(score *applications.AssessmentScore) pgtype.Int2 {
	if score == nil {
		return pgtype.Int2{}
	}
	return pgtype.Int2{Int16: int16(*score), Valid: true}
}

// RecordAssessmentResult stores the result of the candidacy's assessment
// stage and completes the stage (HP-WRK-005).
func RecordAssessmentResult(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.RecordAssessmentResultRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		transition{
			operation: "orgs:record-assessment-result", request: request, inHouse: true,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check:   pendingStageOf(sqlc.VetchiumPipelineStageKindAssessment),
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				row, err := q.RecordOrgAssessmentResult(ctx, sqlc.RecordOrgAssessmentResultParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					Outcome: string(request.Outcome), Score: optionalScore(request.Score),
					Notes: optionalNotes(request.Notes), ReportUrl: optionalReportURL(request.ReportURL),
					ActorID: identity.UserID,
				})
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != row.StoredRows ||
					row.ChangedRows != row.CompletedRows {
					return change{}, false, fmt.Errorf("incomplete assessment result")
				}
				return change{
					action:  sqlc.VetchiumOrgApplicationHistoryActionAssessmentRecorded,
					stageID: locked.CurrentStageID,
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

// RequestBackgroundCheckConsent asks the applicant to consent to the check
// types; nothing is recorded until they do (HP-WRK-006).
func RequestBackgroundCheckConsent(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.RequestBackgroundCheckConsentRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		types := make([]string, len(request.CheckTypes))
		for index, checkType := range request.CheckTypes {
			types[index] = string(checkType)
		}
		transition{
			operation: "orgs:request-background-check-consent", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check:   pendingStageOf(sqlc.VetchiumPipelineStageKindBackgroundCheck),
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, now time.Time) (change, bool, error) {
				id, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return change{}, false, err
				}
				params := sqlc.RequestOrgBackgroundCheckConsentParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					CheckID: id, CheckTypes: types, ActorID: identity.UserID,
				}
				if locked.Routed {
					// A routed stage is performed by the provider, whose
					// disclosure and check types were copied at routing
					// (MKT-WRK-003).
					if !locked.RouteDisclosure.Valid ||
						!locked.RouteEngagementID.Valid {
						return change{refusal: orgsproblem.ApplicationStateConflictError}, false, nil
					}
					for _, checkType := range types {
						if !slices.Contains(locked.RouteCheckTypes, checkType) {
							return change{refusal: invalidFields("check_types")}, false, nil
						}
					}
					params.PerformerEngagementID = locked.RouteEngagementID
					params.ConsentDisclosure = locked.RouteDisclosure
				}
				row, err := q.RequestOrgBackgroundCheckConsent(ctx, params)
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != row.CreatedRows {
					return change{}, false, fmt.Errorf("incomplete consent request")
				}
				return change{
					action:  sqlc.VetchiumOrgApplicationHistoryActionBackgroundCheckConsentRequested,
					stageID: locked.CurrentStageID,
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

// RecordBackgroundCheckResult stores one check's result once the applicant
// consented, and completes the stage with the last result of the request.
func RecordBackgroundCheckResult(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.RecordBackgroundCheckResultRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		transition{
			operation: "orgs:record-background-check-result", request: request, inHouse: true,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check:   pendingStageOf(sqlc.VetchiumPipelineStageKindBackgroundCheck),
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				active, err := q.GetOrgBackgroundCheckForWrite(ctx, sqlc.GetOrgBackgroundCheckForWriteParams{
					ApplicationID: locked.OrgApplicationID, StageID: locked.CurrentStageID,
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return change{refusal: orgsproblem.ApplicationStateConflictError}, false, nil
				}
				if err != nil {
					return change{}, false, fmt.Errorf("read background check: %w", err)
				}
				// Nothing is recorded until the applicant consents.
				if active.ConsentState != sqlc.VetchiumOrgConsentStateGiven {
					return change{refusal: orgsproblem.ApplicationStateConflictError}, false, nil
				}
				checkType := string(request.CheckType)
				if !slices.Contains(active.CheckTypes, checkType) {
					return change{refusal: invalidFields("check_type")}, false, nil
				}
				if slices.Contains(active.RecordedTypes, checkType) {
					return change{refusal: orgsproblem.ApplicationStateConflictError}, false, nil
				}
				row, err := q.RecordOrgBackgroundCheckResult(ctx, sqlc.RecordOrgBackgroundCheckResultParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					CheckType: checkType, Outcome: string(request.Outcome),
					Notes: optionalNotes(request.Notes), ReportUrl: optionalReportURL(request.ReportURL),
					ActorID: identity.UserID,
				})
				if err != nil {
					return change{}, false, err
				}
				wantCompleted := int64(0)
				if row.CompletesStage {
					wantCompleted = row.ChangedRows
				}
				if row.ChangedRows != row.StoredRows || row.CompletedRows != wantCompleted {
					return change{}, false, fmt.Errorf("incomplete background check result")
				}
				return change{
					action:  sqlc.VetchiumOrgApplicationHistoryActionBackgroundCheckResultRecorded,
					stageID: locked.CurrentStageID,
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}
