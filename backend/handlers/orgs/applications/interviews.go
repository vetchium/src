package applications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/feedbackform"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func interviewEmails(emails []common.EmailAddress) []string {
	list := make([]string, len(emails))
	for index, email := range emails {
		list[index] = string(email)
	}
	return list
}

func interviewNumberValue(number applications.InterviewNumber) pgtype.Int4 {
	return pgtype.Int4{Int32: int32(number), Valid: true}
}

// invalidInterviewers decodes the addresses a statement found unavailable.
func invalidInterviewers(stored []byte) ([]string, error) {
	var invalid []string
	if err := json.Unmarshal(stored, &invalid); err != nil {
		return nil, fmt.Errorf("decode invalid interviewers: %w", err)
	}
	return invalid, nil
}

// upcoming loads the interview under the application's lock, or reports the
// refusal: an unknown number, or one that is not a scheduled interview whose
// start is still ahead.
func upcoming(
	ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow,
	viewer pgtype.UUID, number applications.InterviewNumber,
) (sqlc.GetOrgInterviewForWriteRow, problem.Body, error) {
	interview, refusal, err := loadInterview(ctx, q, locked, viewer, number)
	if refusal != nil || err != nil {
		return interview, refusal, err
	}
	if interview.InterviewState != sqlc.VetchiumOrgInterviewStateScheduled ||
		interview.Started {
		return interview, orgsproblem.InterviewStateConflictError, nil
	}
	return interview, nil, nil
}

func loadInterview(
	ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow,
	viewer pgtype.UUID, number applications.InterviewNumber,
) (sqlc.GetOrgInterviewForWriteRow, problem.Body, error) {
	interview, err := q.GetOrgInterviewForWrite(ctx, sqlc.GetOrgInterviewForWriteParams{
		ApplicationID: locked.OrgApplicationID, InterviewNumber: int32(number),
		ViewerID: viewer,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return interview, orgsproblem.InterviewNotFoundError, nil
	}
	if err != nil {
		return interview, nil, fmt.Errorf("read interview: %w", err)
	}
	return interview, nil, nil
}

// candidacyState refuses an application outside the candidacy states.
func candidacyState(locked sqlc.LockOrgApplicationForWriteRow) problem.Body {
	return stateConflict(
		sqlc.VetchiumOrgApplicationStateInPipeline,
		sqlc.VetchiumOrgApplicationStateOffered,
		sqlc.VetchiumOrgApplicationStateOfferAccepted,
	)(locked.ApplicationState)
}

// ScheduleInterview adds an interview to a candidacy in_pipeline at an
// interview stage (HP-WRK-002).
func ScheduleInterview(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ScheduleInterviewRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		transition{
			operation: "orgs:schedule-interview", request: request, inHouse: true,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, now time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateInPipeline,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if locked.CurrentStageKind.VetchiumPipelineStageKind !=
					sqlc.VetchiumPipelineStageKindInterview {
					return orgsproblem.ApplicationStateConflictError
				}
				if !request.StartTime.After(now) {
					return invalidFields("start_time")
				}
				return nil
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, now time.Time) (change, bool, error) {
				id, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return change{}, false, err
				}
				row, err := q.ScheduleOrgInterview(ctx, sqlc.ScheduleOrgInterviewParams{
					InterviewerEmails: interviewEmails(request.InterviewerEmails),
					OrgDid:            identity.OrgDID, ApplicationID: locked.OrgApplicationID,
					Version:       locked.Version,
					MaxInterviews: applications.MaxInterviewsPerStage,
					StartsAt:      dbvalue.Timestamp(request.StartTime),
					InterviewID:   id, DurationMinutes: int16(request.DurationMinutes),
					Mode: string(request.Mode), VideoUrl: optionalURL(request.VideoURL),
					Location: optionalLocation(request.Location), ActorID: identity.UserID,
				})
				if err != nil {
					return change{}, false, err
				}
				invalid, err := invalidInterviewers(row.InvalidAddresses)
				if err != nil {
					return change{}, false, err
				}
				if len(invalid) > 0 {
					return change{refusal: orgsproblem.InterviewInterviewersInvalidError(invalid)}, false, nil
				}
				if row.ChangedRows == 0 &&
					row.StageInterviews >= applications.MaxInterviewsPerStage {
					return change{refusal: orgsproblem.InterviewLimitReachedError(
						applications.MaxInterviewsPerStage)}, false, nil
				}
				if row.ChangedRows == 1 && (row.CreatedRows != 1 ||
					int(row.MemberRows) != len(request.InterviewerEmails)) {
					return change{}, false, fmt.Errorf("incomplete interview schedule")
				}
				return change{
					action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewScheduled,
					stageID:         locked.CurrentStageID,
					interviewNumber: pgtype.Int4{Int32: row.InterviewNumber, Valid: true},
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

// ChangeInterview replaces the details of an upcoming interview; a change of
// time or mode resets the applicant's response (HP-WRK-003).
func ChangeInterview(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ChangeInterviewRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		transition{
			operation: "orgs:change-interview", request: request, inHouse: true,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				return candidacyState(locked)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, now time.Time) (change, bool, error) {
				_, refusal, err := upcoming(ctx, q, locked, identity.UserID, request.InterviewNumber)
				if refusal != nil || err != nil {
					return change{refusal: refusal}, false, err
				}
				if !request.StartTime.After(now) {
					return change{refusal: invalidFields("start_time")}, false, nil
				}
				row, err := q.ChangeOrgInterview(ctx, sqlc.ChangeOrgInterviewParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					InterviewNumber:   int32(request.InterviewNumber),
					InterviewerEmails: interviewEmails(request.InterviewerEmails),
					OrgDid:            identity.OrgDID,
					StartsAt:          dbvalue.Timestamp(request.StartTime),
					DurationMinutes:   int16(request.DurationMinutes),
					Mode:              string(request.Mode),
					VideoUrl:          optionalURL(request.VideoURL),
					Location:          optionalLocation(request.Location),
				})
				if err != nil {
					return change{}, false, err
				}
				invalid, err := invalidInterviewers(row.InvalidAddresses)
				if err != nil {
					return change{}, false, err
				}
				if len(invalid) > 0 {
					return change{refusal: orgsproblem.InterviewInterviewersInvalidError(invalid)}, false, nil
				}
				if row.ChangedRows != row.UpdatedRows {
					return change{}, false, fmt.Errorf("incomplete interview change")
				}
				return change{
					action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewChanged,
					interviewNumber: interviewNumberValue(request.InterviewNumber),
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

// CancelInterview cancels an upcoming interview (HP-WRK-003).
func CancelInterview(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.CancelInterviewRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		transition{
			operation: "orgs:cancel-interview", request: request, inHouse: true,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				return candidacyState(locked)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				_, refusal, err := upcoming(ctx, q, locked, identity.UserID, request.InterviewNumber)
				if refusal != nil || err != nil {
					return change{refusal: refusal}, false, err
				}
				row, err := q.CancelOrgInterview(ctx, sqlc.CancelOrgInterviewParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					InterviewNumber: int32(request.InterviewNumber),
				})
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != row.CancelledRows {
					return change{}, false, fmt.Errorf("incomplete interview cancellation")
				}
				return change{
					action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewCancelled,
					interviewNumber: interviewNumberValue(request.InterviewNumber),
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

// RecordInterviewOutcome records completed or no_show once the start has
// passed, by an interviewer of the interview or someone who acts on the
// Opening's applications (HP-WRK-004).
func RecordInterviewOutcome(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.RecordInterviewOutcomeRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		action := sqlc.VetchiumOrgApplicationHistoryActionInterviewCompleted
		if request.Outcome == applications.OutcomeNoShow {
			action = sqlc.VetchiumOrgApplicationHistoryActionInterviewNoShow
		}
		transition{
			operation: "orgs:record-interview-outcome", request: request, inHouse: true,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version, interviewerMayAct: true,
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				interview, refusal, err := loadInterview(ctx, q, locked, identity.UserID, request.InterviewNumber)
				if refusal != nil || err != nil {
					return change{refusal: refusal}, false, err
				}
				if !locked.CanAct && !interview.ViewerIsInterviewer {
					return change{refusal: orgsproblem.PermissionRequiredError}, false, nil
				}
				// Before the start there is nothing to record.
				if interview.InterviewState != sqlc.VetchiumOrgInterviewStateScheduled ||
					!interview.Started {
					return change{refusal: orgsproblem.InterviewStateConflictError}, false, nil
				}
				row, err := q.RecordOrgInterviewOutcome(ctx, sqlc.RecordOrgInterviewOutcomeParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					InterviewNumber: int32(request.InterviewNumber),
					CanAct:          locked.CanAct, ActorID: identity.UserID,
					Outcome: string(request.Outcome),
				})
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != row.RecordedRows {
					return change{}, false, fmt.Errorf("incomplete interview outcome")
				}
				return change{
					action:          action,
					interviewNumber: interviewNumberValue(request.InterviewNumber),
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

// SubmitInterviewFeedback stores the caller's feedback, once, on a completed
// interview they interview on (HP-WRK-004).
func SubmitInterviewFeedback(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.SubmitInterviewFeedbackRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		transition{
			operation: "orgs:submit-interview-feedback", request: request, inHouse: true,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version, interviewerMayAct: true,
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				interview, refusal, err := loadInterview(ctx, q, locked, identity.UserID, request.InterviewNumber)
				if refusal != nil || err != nil {
					return change{refusal: refusal}, false, err
				}
				if !interview.ViewerIsInterviewer {
					return change{refusal: orgsproblem.PermissionRequiredError}, false, nil
				}
				if interview.ViewerSubmittedFeedback {
					return change{refusal: orgsproblem.InterviewFeedbackExistsError}, false, nil
				}
				if interview.InterviewState != sqlc.VetchiumOrgInterviewStateCompleted {
					return change{refusal: orgsproblem.InterviewStateConflictError}, false, nil
				}
				answers, refusal, err := feedbackform.Encode(interview.FeedbackForm, request.CriteriaAnswers)
				if refusal != nil || err != nil {
					return change{refusal: refusal}, false, err
				}
				row, err := q.SubmitOrgInterviewFeedback(ctx, sqlc.SubmitOrgInterviewFeedbackParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					ActorID:         identity.UserID,
					InterviewNumber: int32(request.InterviewNumber),
					Recommendation:  string(request.Recommendation),
					Notes:           string(request.Notes),
					CriteriaAnswers: answers,
				})
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != row.StoredRows {
					return change{}, false, fmt.Errorf("incomplete interview feedback")
				}
				return change{
					action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewFeedbackSubmitted,
					interviewNumber: interviewNumberValue(request.InterviewNumber),
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

func optionalURL(link *profile.WebsiteURL) pgtype.Text {
	if link == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*link))
}

func optionalLocation(location *applications.InterviewLocation) pgtype.Text {
	if location == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*location))
}
