package providerwork

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/engagements"
	"backend/internal/federation/commands"
	"backend/internal/orgs/applicationchanges"
)

// Register adds the provider work commands to registry. The client's tenant
// executes them as the authority of the routed candidacy; the initiator is
// the provider Org the payload names.
func Register(registry *commands.Registry) {
	registry.Register(federationspec.WorkScheduleInterviewKind, schedule, engagements.Provider)
	registry.Register(federationspec.WorkChangeInterviewKind, change, engagements.Provider)
	registry.Register(federationspec.WorkCancelInterviewKind, cancel, engagements.Provider)
	registry.Register(federationspec.WorkInterviewOutcomeKind, outcome, engagements.Provider)
	registry.Register(federationspec.WorkInterviewFeedbackKind, feedback, engagements.Provider)
	registry.Register(federationspec.WorkAssessmentKind, assessment, engagements.Provider)
	registry.Register(federationspec.WorkBackgroundCheckResultKind, checkResult, engagements.Provider)
}

// done is what a write did, for its history entry and its answer.
type done struct {
	action          sqlc.VetchiumOrgApplicationHistoryAction
	interviewNumber pgtype.Int4
	// refusal rolls the write back and is stored as the command's outcome.
	refusal problem.Body
}

func refuse(details problem.Body) done { return done{refusal: details} }

func invalidFields(fields ...string) problem.Body {
	details := problem.ValidationFailedError
	details.Fields = fields
	return details
}

// execute runs one provider write: it finds the candidacy through its route
// under the application's lock, lets apply decide and write, and records the
// history, audit, and Hub projection. Any miss in finding it is the one
// answer for inaccessible work (MKT-ACC-004).
func execute[P commands.Payload](
	ctx context.Context, tx pgx.Tx, command commands.Command, payload P,
	actor func(P) federationspec.WorkActor,
	apply func(context.Context, *sqlc.Queries, sqlc.LockProviderWorkRow, P, time.Time) (done, error),
) (commands.Result, error) {
	if rejected := commands.DecodeStrict(command, payload); rejected != nil {
		return *rejected, nil
	}
	who := actor(payload)
	if command.AggregateID != string(who.WorkID) {
		return commands.Rejected(invalidFields("aggregate_id")), nil
	}
	workID, err := dbvalue.ParseUUID(string(who.WorkID))
	if err != nil {
		return commands.Result{}, err
	}
	engagementID, err := dbvalue.ParseUUID(string(who.EngagementID))
	if err != nil {
		return commands.Result{}, err
	}
	providerDID, err := dbvalue.ParseUUID(string(who.ProviderOrgDID))
	if err != nil {
		return commands.Result{}, err
	}
	q := sqlc.New(tx)
	locked, err := q.LockProviderWork(ctx, sqlc.LockProviderWorkParams{
		WorkID: workID, EngagementID: engagementID,
		OrgDid: command.Authority.DID, ProviderOrgDid: providerDID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return commands.Rejected(orgsproblem.EngagementWorkNotFoundError), nil
	}
	if err != nil {
		return commands.Result{}, fmt.Errorf("lock provider work: %w", err)
	}
	result, err := apply(ctx, q, locked, payload, time.Now())
	if err != nil {
		return commands.Result{}, err
	}
	if result.refusal != nil {
		return commands.Rejected(result.refusal), nil
	}
	if err := applicationchanges.RecordProvider(ctx, q, locked.OrgApplicationID,
		applicationchanges.ProviderChange{
			Action: result.action, StageID: locked.CurrentStageID,
			InterviewNumber: result.interviewNumber, TenantID: command.TenantID,
			CommandID:    dbvalue.FormatUUID(command.CommandID),
			EngagementID: engagementID, ProviderOrgDID: providerDID,
			ActorEmail: string(who.ActorEmail),
		}); err != nil {
		return commands.Result{}, err
	}
	status, err := q.GetProviderWorkStatus(ctx, sqlc.GetProviderWorkStatusParams{
		EngagementID: engagementID, ApplicationID: locked.OrgApplicationID,
	})
	if err != nil {
		return commands.Result{}, fmt.Errorf("read work status: %w", err)
	}
	answer := work.WriteResult{WorkID: who.WorkID, Status: work.WorkStatus(status)}
	if result.interviewNumber.Valid {
		number := applications.InterviewNumber(result.interviewNumber.Int32)
		answer.InterviewNumber = &number
	}
	return commands.Succeeded(http.StatusOK, answer), nil
}

func interviewNumber(number applications.InterviewNumber) pgtype.Int4 {
	return pgtype.Int4{Int32: int32(number), Valid: true}
}

func details(d applications.InterviewDetails) (
	starts pgtype.Timestamptz, duration int16, mode string, video, location pgtype.Text,
) {
	starts = dbvalue.Timestamp(d.StartTime)
	duration, mode = int16(d.DurationMinutes), string(d.Mode)
	if d.VideoURL != nil {
		video = dbvalue.Text(string(*d.VideoURL))
	}
	if d.Location != nil {
		location = dbvalue.Text(string(*d.Location))
	}
	return
}

// ownInterview finds the interview of the candidacy that this provider holds,
// or the refusal.
func ownInterview(
	ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
	number applications.InterviewNumber, actorEmail string,
) (sqlc.GetProviderInterviewRow, problem.Body, error) {
	interview, err := q.GetProviderInterview(ctx, sqlc.GetProviderInterviewParams{
		ApplicationID: locked.OrgApplicationID, InterviewNumber: int32(number),
		EngagementID: locked.EngagementID, ActorEmail: actorEmail,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return interview, orgsproblem.InterviewNotFoundError, nil
	}
	if err != nil {
		return interview, nil, fmt.Errorf("read provider interview: %w", err)
	}
	return interview, nil, nil
}

func isUpcoming(interview sqlc.GetProviderInterviewRow) bool {
	return interview.InterviewState == sqlc.VetchiumOrgInterviewStateScheduled &&
		!interview.Started
}

func schedule(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return execute(ctx, tx, command, &federationspec.WorkScheduleInterviewPayload{},
		func(p *federationspec.WorkScheduleInterviewPayload) federationspec.WorkActor { return p.WorkActor },
		func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
			p *federationspec.WorkScheduleInterviewPayload, now time.Time,
		) (done, error) {
			if locked.CurrentStageKind != sqlc.VetchiumPipelineStageKindInterview {
				return refuse(orgsproblem.ApplicationStateConflictError), nil
			}
			id, err := dbvalue.NewUUIDv7(now)
			if err != nil {
				return done{}, err
			}
			starts, duration, mode, video, location := details(p.InterviewDetails)
			row, err := q.ScheduleProviderInterview(ctx, sqlc.ScheduleProviderInterviewParams{
				InterviewerEmails: interviewerEmails(p.InterviewerEmails),
				ApplicationID:     locked.OrgApplicationID, Version: locked.Version,
				MaxInterviews: applications.MaxInterviewsPerStage, StartsAt: starts,
				InterviewID: id, DurationMinutes: duration, Mode: mode,
				VideoUrl: video, Location: location,
				EngagementID: locked.EngagementID,
			})
			if err != nil {
				return done{}, err
			}
			if row.ChangedRows == 0 {
				if row.StageInterviews >= applications.MaxInterviewsPerStage {
					return refuse(orgsproblem.InterviewLimitReachedError(
						applications.MaxInterviewsPerStage)), nil
				}
				return refuse(invalidFields("start_time")), nil
			}
			if row.CreatedRows != 1 || int(row.MemberRows) != len(p.InterviewerEmails) {
				return done{}, fmt.Errorf("incomplete interview schedule")
			}
			return done{
				action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewScheduled,
				interviewNumber: pgtype.Int4{Int32: row.InterviewNumber, Valid: true},
			}, nil
		})
}

func change(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return execute(ctx, tx, command, &federationspec.WorkChangeInterviewPayload{},
		func(p *federationspec.WorkChangeInterviewPayload) federationspec.WorkActor { return p.WorkActor },
		func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
			p *federationspec.WorkChangeInterviewPayload, _ time.Time,
		) (done, error) {
			interview, refusal, err := ownInterview(ctx, q, locked, p.InterviewNumber, string(p.ActorEmail))
			if refusal != nil || err != nil {
				return refuse(refusal), err
			}
			if !isUpcoming(interview) {
				return refuse(orgsproblem.InterviewStateConflictError), nil
			}
			starts, duration, mode, video, location := details(p.InterviewDetails)
			row, err := q.ChangeProviderInterview(ctx, sqlc.ChangeProviderInterviewParams{
				ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				InterviewNumber:   int32(p.InterviewNumber),
				InterviewerEmails: interviewerEmails(p.InterviewerEmails),
				EngagementID:      locked.EngagementID, StartsAt: starts,
				DurationMinutes: duration, Mode: mode, VideoUrl: video,
				Location: location,
			})
			if err != nil {
				return done{}, err
			}
			if row.ChangedRows == 0 {
				return refuse(invalidFields("start_time")), nil
			}
			if row.ChangedRows != row.UpdatedRows {
				return done{}, fmt.Errorf("incomplete interview change")
			}
			return done{
				action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewChanged,
				interviewNumber: interviewNumber(p.InterviewNumber),
			}, nil
		})
}

func cancel(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return execute(ctx, tx, command, &federationspec.WorkInterviewReferencePayload{},
		func(p *federationspec.WorkInterviewReferencePayload) federationspec.WorkActor { return p.WorkActor },
		func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
			p *federationspec.WorkInterviewReferencePayload, _ time.Time,
		) (done, error) {
			interview, refusal, err := ownInterview(ctx, q, locked, p.InterviewNumber, string(p.ActorEmail))
			if refusal != nil || err != nil {
				return refuse(refusal), err
			}
			if !isUpcoming(interview) {
				return refuse(orgsproblem.InterviewStateConflictError), nil
			}
			row, err := q.CancelOrgInterview(ctx, sqlc.CancelOrgInterviewParams{
				ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				InterviewNumber: int32(p.InterviewNumber),
			})
			if err != nil {
				return done{}, err
			}
			if row.ChangedRows != 1 || row.CancelledRows != 1 {
				return done{}, fmt.Errorf("incomplete interview cancellation")
			}
			return done{
				action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewCancelled,
				interviewNumber: interviewNumber(p.InterviewNumber),
			}, nil
		})
}

func outcome(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return execute(ctx, tx, command, &federationspec.WorkInterviewOutcomePayload{},
		func(p *federationspec.WorkInterviewOutcomePayload) federationspec.WorkActor { return p.WorkActor },
		func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
			p *federationspec.WorkInterviewOutcomePayload, now time.Time,
		) (done, error) {
			interview, refusal, err := ownInterview(ctx, q, locked, p.InterviewNumber, string(p.ActorEmail))
			if refusal != nil || err != nil {
				return refuse(refusal), err
			}
			// Before the start there is nothing to record.
			if interview.InterviewState != sqlc.VetchiumOrgInterviewStateScheduled ||
				!interview.Started {
				return refuse(orgsproblem.InterviewStateConflictError), nil
			}
			row, err := q.RecordOrgInterviewOutcome(ctx, sqlc.RecordOrgInterviewOutcomeParams{
				ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				InterviewNumber: int32(p.InterviewNumber), CanAct: true,
				Outcome: string(p.Outcome),
			})
			if err != nil {
				return done{}, err
			}
			if row.ChangedRows != 1 || row.RecordedRows != 1 {
				return done{}, fmt.Errorf("incomplete interview outcome")
			}
			action := sqlc.VetchiumOrgApplicationHistoryActionInterviewCompleted
			factKind := marketplace.FactInterviewCompleted
			if p.Outcome == applications.OutcomeNoShow {
				action = sqlc.VetchiumOrgApplicationHistoryActionInterviewNoShow
				factKind = marketplace.FactInterviewNoShow
			}
			if err := q.InsertActivityFact(ctx, sqlc.InsertActivityFactParams{
				OrgDid:               locked.ConsumerOrgDid,
				EngagementID:         locked.EngagementID,
				OrgApplicationID:     locked.OrgApplicationID,
				FactDate:             pgtype.Date{Time: now.UTC().Truncate(24 * time.Hour), Valid: true},
				FactKind:             string(factKind),
				ReferenceID:          strconv.Itoa(int(p.InterviewNumber)),
				OpeningNumber:        locked.OpeningNumber,
				OpeningTitle:         locked.OpeningTitle,
				ApplicationNumber:    locked.ApplicationNumber,
				ApplicantDisplayName: locked.ApplicantDisplayName,
				Corrected:            false,
			}); err != nil {
				return done{}, fmt.Errorf("record interview activity fact: %w", err)
			}
			return done{action: action, interviewNumber: interviewNumber(p.InterviewNumber)}, nil
		})
}

func feedback(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return execute(ctx, tx, command, &federationspec.WorkInterviewFeedbackPayload{},
		func(p *federationspec.WorkInterviewFeedbackPayload) federationspec.WorkActor { return p.WorkActor },
		func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
			p *federationspec.WorkInterviewFeedbackPayload, _ time.Time,
		) (done, error) {
			interview, refusal, err := ownInterview(ctx, q, locked, p.InterviewNumber, string(p.ActorEmail))
			if refusal != nil || err != nil {
				return refuse(refusal), err
			}
			if !interview.ActorIsInterviewer {
				return refuse(orgsproblem.PermissionRequiredError), nil
			}
			if interview.ActorSubmittedFeedback {
				return refuse(orgsproblem.InterviewFeedbackExistsError), nil
			}
			if interview.InterviewState != sqlc.VetchiumOrgInterviewStateCompleted {
				return refuse(orgsproblem.InterviewStateConflictError), nil
			}
			row, err := q.SubmitProviderInterviewFeedback(ctx, sqlc.SubmitProviderInterviewFeedbackParams{
				ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				ActorEmail: string(p.ActorEmail), InterviewNumber: int32(p.InterviewNumber),
				EngagementID: locked.EngagementID, Recommendation: string(p.Recommendation),
				Notes: string(p.Notes),
			})
			if err != nil {
				return done{}, err
			}
			if row.ChangedRows != 1 || row.StoredRows != 1 {
				return done{}, fmt.Errorf("incomplete interview feedback")
			}
			return done{
				action:          sqlc.VetchiumOrgApplicationHistoryActionInterviewFeedbackSubmitted,
				interviewNumber: interviewNumber(p.InterviewNumber),
			}, nil
		})
}

// pendingStage reports whether the candidacy is at a pending stage of kind.
func pendingStage(locked sqlc.LockProviderWorkRow, kind sqlc.VetchiumPipelineStageKind) bool {
	return locked.CurrentStageKind == kind &&
		locked.CurrentStageStatus == string(applications.StagePending)
}

func assessment(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return execute(ctx, tx, command, &federationspec.WorkAssessmentPayload{},
		func(p *federationspec.WorkAssessmentPayload) federationspec.WorkActor { return p.WorkActor },
		func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
			p *federationspec.WorkAssessmentPayload, now time.Time,
		) (done, error) {
			if !pendingStage(locked, sqlc.VetchiumPipelineStageKindAssessment) {
				return refuse(orgsproblem.ApplicationStateConflictError), nil
			}
			var score pgtype.Int2
			if p.Score != nil {
				score = pgtype.Int2{Int16: int16(*p.Score), Valid: true}
			}
			row, err := q.RecordOrgAssessmentResult(ctx, sqlc.RecordOrgAssessmentResultParams{
				ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				Outcome: string(p.Outcome), Score: score,
				Notes: optionalNotes(p.Notes), ReportUrl: optionalLink(p.ReportURL),
			})
			if err != nil {
				return done{}, err
			}
			if row.ChangedRows != 1 || row.StoredRows != 1 || row.CompletedRows != 1 {
				return done{}, fmt.Errorf("incomplete assessment result")
			}
			marked, err := q.SetAssessmentPerformer(ctx, sqlc.SetAssessmentPerformerParams{
				EngagementID: locked.EngagementID, ActorEmail: string(p.ActorEmail),
				ApplicationID: locked.OrgApplicationID, StageID: locked.CurrentStageID,
			})
			if err != nil {
				return done{}, err
			}
			if marked != 1 {
				return done{}, fmt.Errorf("assessment result not marked as the provider's")
			}
			if err := q.InsertActivityFact(ctx, sqlc.InsertActivityFactParams{
				OrgDid:               locked.ConsumerOrgDid,
				EngagementID:         locked.EngagementID,
				OrgApplicationID:     locked.OrgApplicationID,
				FactDate:             pgtype.Date{Time: now.UTC().Truncate(24 * time.Hour), Valid: true},
				FactKind:             string(marketplace.FactAssessmentResult),
				ReferenceID:          "",
				OpeningNumber:        locked.OpeningNumber,
				OpeningTitle:         locked.OpeningTitle,
				ApplicationNumber:    locked.ApplicationNumber,
				ApplicantDisplayName: locked.ApplicantDisplayName,
				Corrected:            false,
			}); err != nil {
				return done{}, fmt.Errorf("record assessment activity fact: %w", err)
			}
			return done{action: sqlc.VetchiumOrgApplicationHistoryActionAssessmentRecorded}, nil
		})
}

func checkResult(
	ctx context.Context, tx pgx.Tx, command commands.Command,
) (commands.Result, error) {
	return execute(ctx, tx, command, &federationspec.WorkBackgroundCheckResultPayload{},
		func(p *federationspec.WorkBackgroundCheckResultPayload) federationspec.WorkActor { return p.WorkActor },
		func(ctx context.Context, q *sqlc.Queries, locked sqlc.LockProviderWorkRow,
			p *federationspec.WorkBackgroundCheckResultPayload, now time.Time,
		) (done, error) {
			if !pendingStage(locked, sqlc.VetchiumPipelineStageKindBackgroundCheck) {
				return refuse(orgsproblem.ApplicationStateConflictError), nil
			}
			active, err := q.GetOrgBackgroundCheckForWrite(ctx, sqlc.GetOrgBackgroundCheckForWriteParams{
				ApplicationID: locked.OrgApplicationID, StageID: locked.CurrentStageID,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return refuse(orgsproblem.ApplicationStateConflictError), nil
			}
			if err != nil {
				return done{}, fmt.Errorf("read background check: %w", err)
			}
			// Nothing is recorded until the applicant consents, and only for
			// a request that names this provider.
			if active.ConsentState != sqlc.VetchiumOrgConsentStateGiven ||
				active.PerformerEngagementID != locked.EngagementID {
				return refuse(orgsproblem.ApplicationStateConflictError), nil
			}
			checkType := string(p.CheckType)
			if !slices.Contains(active.CheckTypes, checkType) {
				return refuse(invalidFields("check_type")), nil
			}
			if slices.Contains(active.RecordedTypes, checkType) {
				return refuse(orgsproblem.ApplicationStateConflictError), nil
			}
			row, err := q.RecordOrgBackgroundCheckResult(ctx, sqlc.RecordOrgBackgroundCheckResultParams{
				ApplicationID: locked.OrgApplicationID, Version: locked.Version,
				CheckType: checkType, Outcome: string(p.Outcome),
				Notes: optionalNotes(p.Notes), ReportUrl: optionalLink(p.ReportURL),
			})
			if err != nil {
				return done{}, err
			}
			wantCompleted := int64(0)
			if row.CompletesStage {
				wantCompleted = row.ChangedRows
			}
			if row.ChangedRows != 1 || row.StoredRows != 1 || row.CompletedRows != wantCompleted {
				return done{}, fmt.Errorf("incomplete background check result")
			}
			marked, err := q.SetBackgroundCheckResultPerformer(ctx, sqlc.SetBackgroundCheckResultPerformerParams{
				ActorEmail: string(p.ActorEmail), ApplicationID: locked.OrgApplicationID,
				StageID: locked.CurrentStageID, EngagementID: locked.EngagementID,
				CheckType: checkType,
			})
			if err != nil {
				return done{}, err
			}
			if marked != 1 {
				return done{}, fmt.Errorf("check result not marked as the provider's")
			}
			if err := q.InsertActivityFact(ctx, sqlc.InsertActivityFactParams{
				OrgDid:               locked.ConsumerOrgDid,
				EngagementID:         locked.EngagementID,
				OrgApplicationID:     locked.OrgApplicationID,
				FactDate:             pgtype.Date{Time: now.UTC().Truncate(24 * time.Hour), Valid: true},
				FactKind:             string(marketplace.FactBackgroundCheckOutcome),
				ReferenceID:          checkType,
				OpeningNumber:        locked.OpeningNumber,
				OpeningTitle:         locked.OpeningTitle,
				ApplicationNumber:    locked.ApplicationNumber,
				ApplicantDisplayName: locked.ApplicantDisplayName,
				Corrected:            false,
			}); err != nil {
				return done{}, fmt.Errorf("record background-check activity fact: %w", err)
			}
			return done{action: sqlc.VetchiumOrgApplicationHistoryActionBackgroundCheckResultRecorded}, nil
		})
}

func interviewerEmails(list []common.EmailAddress) []string {
	emails := make([]string, len(list))
	for index, email := range list {
		emails[index] = string(email)
	}
	return emails
}

func optionalNotes(notes *applications.ResultNotes) pgtype.Text {
	if notes == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*notes))
}

func optionalLink(link *profile.WebsiteURL) pgtype.Text {
	if link == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*link))
}
