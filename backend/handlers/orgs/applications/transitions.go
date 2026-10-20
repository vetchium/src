package applications

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	"backend/internal/orgs/applicationchanges"
)

const (
	// correctionWindow is how long after first recording the Org may correct
	// joined_on or separated_on (HP-STA-005).
	correctionWindow = 90 * 24 * time.Hour
	// maxSeparationDays bounds separated_on after joined_on (HP-STA-005).
	maxSeparationDays = 365
)

// transition is one Org write on an application. run takes the application's
// lock, refuses what the caller, the version, or the state forbid, applies
// the guarded statement, and records history, audit, and the Hub projection.
type transition struct {
	operation string
	request   any
	opening   openings.OpeningNumber
	number    applications.ApplicationNumber
	version   applications.ApplicationVersion
	// targetStage is the stage a shortlist or move names.
	targetStage *hiring.PipelineStageID
	// interviewerMayAct lets a reader who only interviews on the application
	// reach apply, which then decides permission from the interview itself
	// (HP-AUTH-003).
	interviewerMayAct bool
	// inHouse marks work a provider performs on a routed stage; the Org
	// refuses it while the candidacy is routed (MKT-WRK-001).
	inHouse bool
	// check refuses a state or an input the locked application cannot take;
	// nil refuses nothing.
	check func(locked sqlc.LockOrgApplicationForWriteRow, now time.Time) problem.Body
	// apply runs the guarded statement and reports whether it changed the
	// application. The change it returns carries what the history records.
	apply func(
		ctx context.Context, q *sqlc.Queries,
		locked sqlc.LockOrgApplicationForWriteRow, now time.Time,
	) (change, bool, error)
}

// change is what the history entry and audit event record. A refusal is an
// input the statement found unusable; the transaction rolls back.
type change struct {
	action      sqlc.VetchiumOrgApplicationHistoryAction
	stageID     pgtype.UUID
	joinedOn    pgtype.Date
	separatedOn pgtype.Date
	// interviewNumber is the interview an interview action concerns.
	interviewNumber pgtype.Int4
	refusal         problem.Body
}

func (t transition) run(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
) {
	key, ok := handlerauth.IdempotencyKey(s, w, r)
	if !ok {
		return
	}
	identity, _ := middleware.OrgIdentityFromContext(r.Context())
	now := s.CurrentTime()
	type result = handlerauth.Result[applications.ApplicationDetail]
	handlerauth.RunIdempotent(s, w, r, t.operation,
		dbvalue.FormatUUID(identity.UserID), key, t.request,
		now.Add(24*time.Hour),
		func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
			ctx := r.Context()
			lockParams := sqlc.LockOrgApplicationForWriteParams{
				ViewerID: identity.UserID, OrgDid: identity.OrgDID,
				OpeningNumber:     int32(t.opening),
				ApplicationNumber: int32(t.number),
			}
			if t.targetStage != nil {
				stageID, err := dbvalue.ParseUUID(string(*t.targetStage))
				if err != nil {
					return result{}, nil, err
				}
				lockParams.TargetStageID = stageID
			}
			locked, err := q.LockOrgApplicationForWrite(ctx, lockParams)
			if errors.Is(err, pgx.ErrNoRows) {
				return handlerauth.Failure[applications.ApplicationDetail](
					orgsproblem.ApplicationNotFoundError)
			}
			if err != nil {
				return result{}, nil, err
			}
			if !locked.CanAct && !t.interviewerMayAct {
				return handlerauth.Failure[applications.ApplicationDetail](
					orgsproblem.PermissionRequiredError)
			}
			if locked.Version != int32(t.version) {
				return handlerauth.Failure[applications.ApplicationDetail](
					orgsproblem.ApplicationVersionConflictError)
			}
			if t.inHouse && locked.Routed {
				return handlerauth.Failure[applications.ApplicationDetail](
					orgsproblem.ApplicationStateConflictError)
			}
			if t.check != nil {
				if details := t.check(locked, now); details != nil {
					return handlerauth.Failure[applications.ApplicationDetail](details)
				}
			}
			changed, applied, err := t.apply(ctx, q, locked, now)
			if err != nil {
				return result{}, nil, err
			}
			if changed.refusal != nil {
				return handlerauth.Failure[applications.ApplicationDetail](
					changed.refusal)
			}
			if !applied {
				// The row lock makes this unreachable unless check and the
				// statement's guards disagree.
				return handlerauth.Failure[applications.ApplicationDetail](
					orgsproblem.ApplicationStateConflictError)
			}
			if err := applicationchanges.Record(ctx, q,
				[]pgtype.UUID{locked.OrgApplicationID},
				applicationchanges.Change{
					Action: changed.action, ActorID: identity.UserID,
					StageID: changed.stageID, JoinedOn: changed.joinedOn,
					SeparatedOn:     changed.separatedOn,
					InterviewNumber: changed.interviewNumber, TenantID: s.TenantID,
					IdempotencyKey: string(key),
				}); err != nil {
				return result{}, nil, err
			}
			row, err := q.GetOrgApplication(ctx, sqlc.GetOrgApplicationParams{
				OrgDid: identity.OrgDID, OpeningNumber: int32(t.opening),
				ApplicationNumber: int32(t.number), ViewerID: identity.UserID,
			})
			if err != nil {
				return result{}, nil, fmt.Errorf("read changed application: %w", err)
			}
			detail, err := buildDetail(ctx, s.OfferLetters, t.opening, row)
			if err != nil {
				return result{}, nil, err
			}
			return result{Status: http.StatusOK, Body: detail}, nil, nil
		})
}

func stateConflict(allowed ...sqlc.VetchiumOrgApplicationState) func(
	sqlc.VetchiumOrgApplicationState,
) problem.Body {
	return func(state sqlc.VetchiumOrgApplicationState) problem.Body {
		for _, ok := range allowed {
			if state == ok {
				return nil
			}
		}
		return orgsproblem.ApplicationStateConflictError
	}
}

func invalidFields(fields ...string) problem.Body {
	details := problem.ValidationFailedError
	details.Fields = fields
	return details
}

// today is the UTC calendar date of now, the "today" the date rules use.
func today(now time.Time) time.Time {
	year, month, day := now.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func parseDate(value applications.CalendarDate) pgtype.Date {
	parsed, _ := applications.ParseCalendarDate(value)
	return pgtype.Date{Time: parsed, Valid: true}
}

// offerDate is the calendar date the accepted offer was extended, if known.
func offerDate(locked sqlc.LockOrgApplicationForWriteRow) (time.Time, bool) {
	if !locked.OfferExtendedAt.Valid {
		return time.Time{}, false
	}
	return today(locked.OfferExtendedAt.Time), true
}

func joinedOnProblem(
	joinedOn time.Time, locked sqlc.LockOrgApplicationForWriteRow,
	now time.Time,
) problem.Body {
	if joinedOn.After(today(now)) {
		return invalidFields("joined_on")
	}
	if offered, known := offerDate(locked); known && joinedOn.Before(offered) {
		return invalidFields("joined_on")
	}
	return nil
}

func ShortlistApplication(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationStageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		transition{
			operation: "orgs:shortlist-application", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version, targetStage: &request.StageID,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateSubmitted,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if !locked.TargetPosition.Valid {
					return invalidFields("stage_id")
				}
				return nil
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				stageID, err := dbvalue.ParseUUID(string(request.StageID))
				if err != nil {
					return change{}, false, err
				}
				row, err := q.ShortlistOrgApplication(ctx, sqlc.ShortlistOrgApplicationParams{
					ApplicationID: locked.OrgApplicationID, StageID: stageID,
					Version: locked.Version,
				})
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows == 1 && row.RecordRows < 1 {
					return change{}, false, fmt.Errorf("shortlist recorded no stages")
				}
				return change{
					action:  sqlc.VetchiumOrgApplicationHistoryActionShortlisted,
					stageID: stageID,
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

func MoveApplicationStage(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationStageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		transition{
			operation: "orgs:move-application-stage", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version, targetStage: &request.StageID,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateInPipeline,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if !locked.TargetPosition.Valid {
					return invalidFields("stage_id")
				}
				// Moving back and sideways are not offered (HP-STA-003).
				if !locked.CurrentPosition.Valid ||
					locked.TargetPosition.Int16 <= locked.CurrentPosition.Int16 {
					return orgsproblem.ApplicationStateConflictError
				}
				return nil
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				stageID, err := dbvalue.ParseUUID(string(request.StageID))
				if err != nil {
					return change{}, false, err
				}
				row, err := q.MoveOrgApplicationStage(ctx, sqlc.MoveOrgApplicationStageParams{
					ApplicationID: locked.OrgApplicationID, StageID: stageID,
					Version: locked.Version,
				})
				if err != nil {
					return change{}, false, err
				}
				return change{
					action:  sqlc.VetchiumOrgApplicationHistoryActionStageMoved,
					stageID: stageID,
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

func CompleteApplicationStage(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationActionRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		transition{
			operation: "orgs:complete-application-stage", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateInPipeline,
				)(locked.ApplicationState); details != nil {
					return details
				}
				// Only a review stage is marked by hand; the other kinds
				// complete through their results (HP-WRK-001).
				if locked.CurrentStageKind.VetchiumPipelineStageKind !=
					sqlc.VetchiumPipelineStageKindReview ||
					locked.CurrentStageStatus != string(applications.StagePending) {
					return orgsproblem.ApplicationStateConflictError
				}
				return nil
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				row, err := q.CompleteOrgApplicationStage(ctx, sqlc.CompleteOrgApplicationStageParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				})
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != row.CompletedRows {
					return change{}, false, fmt.Errorf("incomplete stage completion")
				}
				return change{
					action:  sqlc.VetchiumOrgApplicationHistoryActionStageCompleted,
					stageID: locked.CurrentStageID,
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

func MarkApplicationNotProgressing(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationActionRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		transition{
			operation: "orgs:mark-application-not-progressing", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				return stateConflict(
					sqlc.VetchiumOrgApplicationStateSubmitted,
					sqlc.VetchiumOrgApplicationStateInPipeline,
					sqlc.VetchiumOrgApplicationStateOffered,
					sqlc.VetchiumOrgApplicationStateOfferAccepted,
				)(locked.ApplicationState)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				row, err := q.MarkOrgApplicationNotProgressing(ctx, sqlc.MarkOrgApplicationNotProgressingParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				})
				return change{
					action: sqlc.VetchiumOrgApplicationHistoryActionNotProgressing,
				}, row.ChangedRows == 1, err
			},
		}.run(s, w, r)
	}
}

func RecordApplicationJoined(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationJoinedOnRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		joinedOn := parseDate(request.JoinedOn)
		transition{
			operation: "orgs:record-application-joined", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, now time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateOfferAccepted,
				)(locked.ApplicationState); details != nil {
					return details
				}
				return joinedOnProblem(joinedOn.Time, locked, now)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				rows, err := q.RecordOrgApplicationJoined(ctx, sqlc.RecordOrgApplicationJoinedParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					JoinedOn: joinedOn,
				})
				return change{
					action:   sqlc.VetchiumOrgApplicationHistoryActionJoined,
					joinedOn: joinedOn,
				}, rows == 1, err
			},
		}.run(s, w, r)
	}
}

func RecordApplicationDidNotJoin(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationActionRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		transition{
			operation: "orgs:record-application-did-not-join", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				return stateConflict(
					sqlc.VetchiumOrgApplicationStateOfferAccepted,
				)(locked.ApplicationState)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				rows, err := q.RecordOrgApplicationDidNotJoin(ctx, sqlc.RecordOrgApplicationDidNotJoinParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				})
				return change{
					action: sqlc.VetchiumOrgApplicationHistoryActionDidNotJoin,
				}, rows == 1, err
			},
		}.run(s, w, r)
	}
}

func separatedOnProblem(
	separatedOn time.Time, locked sqlc.LockOrgApplicationForWriteRow,
	now time.Time,
) problem.Body {
	joined := locked.JoinedOn.Time
	if !separatedOn.After(joined) ||
		separatedOn.After(joined.AddDate(0, 0, maxSeparationDays)) ||
		separatedOn.After(today(now)) {
		return invalidFields("separated_on")
	}
	return nil
}

func RecordApplicationSeparated(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationSeparatedOnRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		separatedOn := parseDate(request.SeparatedOn)
		transition{
			operation: "orgs:record-application-separated", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, now time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateJoined,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if locked.SeparatedOn.Valid {
					return orgsproblem.ApplicationStateConflictError
				}
				return separatedOnProblem(separatedOn.Time, locked, now)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				rows, err := q.RecordOrgApplicationSeparated(ctx, sqlc.RecordOrgApplicationSeparatedParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					SeparatedOn: separatedOn,
				})
				return change{
					action:      sqlc.VetchiumOrgApplicationHistoryActionSeparated,
					separatedOn: separatedOn,
				}, rows == 1, err
			},
		}.run(s, w, r)
	}
}

// windowOpen reports whether recorded, a first recording, is still inside
// the correction window.
func windowOpen(recorded pgtype.Timestamptz, now time.Time) bool {
	return recorded.Valid && recorded.Time.After(now.Add(-correctionWindow))
}

func CorrectApplicationJoinedOn(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationJoinedOnRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		joinedOn := parseDate(request.JoinedOn)
		transition{
			operation: "orgs:correct-application-joined-on", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, now time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateJoined,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if !windowOpen(locked.JoinedRecordedAt, now) {
					return orgsproblem.ApplicationStateConflictError
				}
				if details := joinedOnProblem(joinedOn.Time, locked, now); details != nil {
					return details
				}
				// The recorded separation must stay after the new joining
				// date and within a year of it.
				if locked.SeparatedOn.Valid &&
					(!locked.SeparatedOn.Time.After(joinedOn.Time) ||
						locked.SeparatedOn.Time.After(joinedOn.Time.AddDate(0, 0, maxSeparationDays))) {
					return invalidFields("joined_on")
				}
				return nil
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, now time.Time) (change, bool, error) {
				rows, err := q.CorrectOrgApplicationJoinedOn(ctx, sqlc.CorrectOrgApplicationJoinedOnParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					JoinedOn:    joinedOn,
					WindowStart: dbvalue.Timestamp(now.Add(-correctionWindow)),
				})
				return change{
					action:   sqlc.VetchiumOrgApplicationHistoryActionJoinedCorrected,
					joinedOn: joinedOn,
				}, rows == 1, err
			},
		}.run(s, w, r)
	}
}

func CorrectApplicationSeparatedOn(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationSeparatedOnRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		separatedOn := parseDate(request.SeparatedOn)
		transition{
			operation: "orgs:correct-application-separated-on", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, now time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateJoined,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if !locked.SeparatedOn.Valid ||
					!windowOpen(locked.SeparatedRecordedAt, now) {
					return orgsproblem.ApplicationStateConflictError
				}
				return separatedOnProblem(separatedOn.Time, locked, now)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, now time.Time) (change, bool, error) {
				rows, err := q.CorrectOrgApplicationSeparatedOn(ctx, sqlc.CorrectOrgApplicationSeparatedOnParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					SeparatedOn: separatedOn,
					WindowStart: dbvalue.Timestamp(now.Add(-correctionWindow)),
				})
				return change{
					action:      sqlc.VetchiumOrgApplicationHistoryActionSeparatedCorrected,
					separatedOn: separatedOn,
				}, rows == 1, err
			},
		}.run(s, w, r)
	}
}

// ExtendApplicationOffer claims the caller's uploaded letter and extends an
// offer to an in_pipeline candidacy at any stage (HP-STA-004, HP-WRK-008).
func ExtendApplicationOffer(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ExtendApplicationOfferRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		var proposed pgtype.Date
		if request.ProposedJoiningDate != nil {
			proposed = parseDate(*request.ProposedJoiningDate)
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		transition{
			operation: "orgs:extend-application-offer", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, now time.Time) problem.Body {
				if details := stateConflict(
					sqlc.VetchiumOrgApplicationStateInPipeline,
				)(locked.ApplicationState); details != nil {
					return details
				}
				if proposed.Valid && proposed.Time.Before(today(now)) {
					return invalidFields("proposed_joining_date")
				}
				return nil
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				letterID, err := dbvalue.ParseUUID(string(request.LetterID))
				if err != nil {
					return change{}, false, err
				}
				claimed, err := q.ClaimOrgOfferLetter(ctx, sqlc.ClaimOrgOfferLetterParams{
					ObjectID: letterID, OrgDid: identity.OrgDID,
					OrgUserID: identity.UserID,
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return change{refusal: invalidFields("letter_id")}, false, nil
				}
				if err != nil {
					return change{}, false, err
				}
				row, err := q.ExtendOrgApplicationOffer(ctx, sqlc.ExtendOrgApplicationOfferParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
					LetterObjectID: claimed, ProposedJoiningDate: proposed,
					RespondWithinDays: int32(request.RespondWithinDays),
					ActorID:           identity.UserID,
				})
				if err != nil {
					return change{}, false, err
				}
				if row.ChangedRows != row.OfferRows {
					return change{}, false, fmt.Errorf("offer extension recorded no offer")
				}
				return change{
					action: sqlc.VetchiumOrgApplicationHistoryActionOfferExtended,
				}, row.ChangedRows == 1, nil
			},
		}.run(s, w, r)
	}
}

// WithdrawApplicationOffer ends the offer awaiting an answer; the candidacy
// returns to in_pipeline at its stage, and the letter stays for the Org.
func WithdrawApplicationOffer(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applications.ApplicationActionRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		transition{
			operation: "orgs:withdraw-application-offer", request: request,
			opening: request.OpeningNumber, number: request.ApplicationNumber,
			version: request.Version,
			check: func(locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) problem.Body {
				return stateConflict(
					sqlc.VetchiumOrgApplicationStateOffered,
				)(locked.ApplicationState)
			},
			apply: func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockOrgApplicationForWriteRow, _ time.Time) (change, bool, error) {
				row, err := q.WithdrawOrgApplicationOffer(ctx, sqlc.WithdrawOrgApplicationOfferParams{
					ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				})
				return change{
					action: sqlc.VetchiumOrgApplicationHistoryActionOfferWithdrawn,
				}, row.ChangedRows == 1, err
			},
		}.run(s, w, r)
	}
}
