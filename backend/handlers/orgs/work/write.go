package work

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	operationspec "github.com/vetchium/src/typespec/orgs/operations"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

// pending is a work write the provider's tenant sends to the client's tenant.
type pending[R any] struct {
	kind federationspec.CommandKind
	// target names the work the request is about.
	target func(R) (marketplace.EngagementID, work.WorkID)
	// payload is the replayable command for the request.
	payload func(R, federationspec.WorkActor) any
	// precheck refuses what this tenant alone can judge before sending, such
	// as interviewers who are not the provider's own users.
	precheck func(context.Context, *orgsruntime.Server, middleware.OrgIdentity, R) (problem.Body, error)
}

// send serves a provider's write. This tenant authorizes its own user and
// checks the interviewers; the client's tenant, which is authoritative,
// decides everything about the candidacy when it executes the durable
// command.
func send[R any, PR interface {
	*R
	apiserver.Request
}](s *orgsruntime.Server, write pending[R]) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request R
		if !apiserver.Decode(s, w, r, PR(&request)) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		engagementID, workID := write.target(request)
		held, _, details, err := client(r.Context(), s, identity, string(engagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "find client", err)
			return
		}
		if details != nil {
			s.Problem(r.Context(), w, *details)
			return
		}
		if write.precheck != nil {
			refusal, err := write.precheck(r.Context(), s, identity, request)
			if err != nil {
				s.InternalError(r.Context(), w, "check work request", err)
				return
			}
			if refusal != nil {
				s.Problem(r.Context(), w, refusal)
				return
			}
		}
		info, err := s.Queries.GetOrgMyInfo(r.Context(), identity.UserID)
		if err != nil {
			s.InternalError(r.Context(), w, "read acting user", err)
			return
		}
		digest, err := json.Marshal(request)
		if err != nil {
			s.InternalError(r.Context(), w, "encode work request", err)
			return
		}
		sum := sha256.Sum256(digest)
		outcome, err := s.Commands.Send(r.Context(), commands.Request{
			Kind: write.kind,
			Authority: commands.Principal{
				Type: directoryspec.PrincipalOrg, DID: held.ConsumerOrgDid,
			},
			AggregateID: string(workID),
			Owner: commands.Owner{
				Type: commands.OwnerOrgUser, ID: dbvalue.FormatUUID(identity.UserID),
			},
			IdempotencyKey: key, RequestDigest: sum[:],
			Payload: write.payload(request, federationspec.WorkActor{
				EngagementID: engagementID, WorkID: workID,
				ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
				ActorEmail:     common.EmailAddress(info.EmailAddress),
			}),
		})
		answer(s, w, r, write.kind, outcome, err)
	}
}

// refusals are the problems a client's tenant may store for a work write,
// which this tenant passes on as the contract declares them.
var refusals = []problem.Details{
	orgsproblem.EngagementWorkNotFoundError,
	orgsproblem.ApplicationStateConflictError,
	orgsproblem.InterviewNotFoundError,
	orgsproblem.InterviewStateConflictError,
	orgsproblem.InterviewFeedbackExistsError,
	orgsproblem.PermissionRequiredError,
	problem.ValidationFailedError,
}

// answer writes the outcome of a work command: the typed result, a stored
// refusal the contract declares, a pending operation to poll, or an
// unreachable client tenant.
func answer(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	kind federationspec.CommandKind, outcome commands.Outcome, err error,
) {
	if errors.Is(err, commands.ErrIdempotencyConflict) {
		s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		return
	}
	if err != nil {
		s.InternalError(r.Context(), w, "send "+string(kind), err)
		return
	}
	switch outcome.State {
	case commands.StateSucceeded:
		var result work.WriteResult
		if err := json.Unmarshal(outcome.Response.Body, &result); err != nil || !result.Valid() {
			s.InternalError(r.Context(), w, "decode work result",
				fmt.Errorf("invalid result of %s: %v", kind, err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	case commands.StateFailed:
		var details problem.Details
		_ = json.Unmarshal(outcome.Response.Body, &details)
		if details.Type == orgsproblem.InterviewLimitReachedError(0).Type {
			var limit orgsproblem.InterviewLimitReachedDetails
			if json.Unmarshal(outcome.Response.Body, &limit) == nil && limit.Limit > 0 {
				s.Problem(r.Context(), w, limit)
				return
			}
		}
		for _, known := range refusals {
			if details.Type == known.Type {
				if known.Type == problem.ValidationFailedError.Type {
					known.Fields = details.Fields
				}
				s.Problem(r.Context(), w, known)
				return
			}
		}
		s.InternalError(r.Context(), w, "map work command rejection",
			fmt.Errorf("unexpected rejection %d %s from %s", outcome.Response.Status, details.Type, kind))
	case commands.StatePending:
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusAccepted, operationspec.PendingOperation{
			OperationID: operationspec.OperationID(dbvalue.FormatUUID(outcome.OperationID)),
		})
	default:
		s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
	}
}

// ownInterviewers refuses interviewers who are not active users of this Org
// holding org:fulfil_engagements.
func ownInterviewers(emails []common.EmailAddress) func(
	context.Context, *orgsruntime.Server, middleware.OrgIdentity,
) (problem.Body, error) {
	return func(
		ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity,
	) (problem.Body, error) {
		list := make([]string, len(emails))
		for index, email := range emails {
			list[index] = string(email)
		}
		invalid, err := s.Queries.ListUnavailableProviderInterviewers(ctx,
			sqlc.ListUnavailableProviderInterviewersParams{
				InterviewerEmails: list, OrgDid: identity.OrgDID,
			})
		if err != nil {
			return nil, err
		}
		if len(invalid) > 0 {
			return orgsproblem.InterviewInterviewersInvalidError(invalid), nil
		}
		return nil, nil
	}
}

func ScheduleWorkInterview(s *orgsruntime.Server) http.HandlerFunc {
	return send[work.ScheduleInterviewRequest](s, pending[work.ScheduleInterviewRequest]{
		kind: federationspec.WorkScheduleInterviewKind,
		target: func(r work.ScheduleInterviewRequest) (marketplace.EngagementID, work.WorkID) {
			return r.EngagementID, r.WorkID
		},
		payload: func(r work.ScheduleInterviewRequest, actor federationspec.WorkActor) any {
			return federationspec.WorkScheduleInterviewPayload{
				WorkActor: actor, InterviewDetails: r.InterviewDetails,
			}
		},
		precheck: func(ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity, r work.ScheduleInterviewRequest) (problem.Body, error) {
			return ownInterviewers(r.InterviewerEmails)(ctx, s, identity)
		},
	})
}

func ChangeWorkInterview(s *orgsruntime.Server) http.HandlerFunc {
	return send[work.ChangeInterviewRequest](s, pending[work.ChangeInterviewRequest]{
		kind: federationspec.WorkChangeInterviewKind,
		target: func(r work.ChangeInterviewRequest) (marketplace.EngagementID, work.WorkID) {
			return r.EngagementID, r.WorkID
		},
		payload: func(r work.ChangeInterviewRequest, actor federationspec.WorkActor) any {
			return federationspec.WorkChangeInterviewPayload{
				WorkActor: actor, InterviewNumber: r.InterviewNumber,
				InterviewDetails: r.InterviewDetails,
			}
		},
		precheck: func(ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity, r work.ChangeInterviewRequest) (problem.Body, error) {
			return ownInterviewers(r.InterviewerEmails)(ctx, s, identity)
		},
	})
}

func CancelWorkInterview(s *orgsruntime.Server) http.HandlerFunc {
	return send[work.InterviewReference](s, pending[work.InterviewReference]{
		kind: federationspec.WorkCancelInterviewKind,
		target: func(r work.InterviewReference) (marketplace.EngagementID, work.WorkID) {
			return r.EngagementID, r.WorkID
		},
		payload: func(r work.InterviewReference, actor federationspec.WorkActor) any {
			return federationspec.WorkInterviewReferencePayload{
				WorkActor: actor, InterviewNumber: r.InterviewNumber,
			}
		},
	})
}

func RecordWorkInterviewOutcome(s *orgsruntime.Server) http.HandlerFunc {
	return send[work.RecordInterviewOutcomeRequest](s, pending[work.RecordInterviewOutcomeRequest]{
		kind: federationspec.WorkInterviewOutcomeKind,
		target: func(r work.RecordInterviewOutcomeRequest) (marketplace.EngagementID, work.WorkID) {
			return r.EngagementID, r.WorkID
		},
		payload: func(r work.RecordInterviewOutcomeRequest, actor federationspec.WorkActor) any {
			return federationspec.WorkInterviewOutcomePayload{
				WorkActor: actor, InterviewNumber: r.InterviewNumber, Outcome: r.Outcome,
			}
		},
	})
}

func SubmitWorkInterviewFeedback(s *orgsruntime.Server) http.HandlerFunc {
	return send[work.SubmitInterviewFeedbackRequest](s, pending[work.SubmitInterviewFeedbackRequest]{
		kind: federationspec.WorkInterviewFeedbackKind,
		target: func(r work.SubmitInterviewFeedbackRequest) (marketplace.EngagementID, work.WorkID) {
			return r.EngagementID, r.WorkID
		},
		payload: func(r work.SubmitInterviewFeedbackRequest, actor federationspec.WorkActor) any {
			return federationspec.WorkInterviewFeedbackPayload{
				WorkActor: actor, InterviewNumber: r.InterviewNumber,
				Recommendation: r.Recommendation, Notes: r.Notes,
			}
		},
	})
}

func RecordWorkAssessment(s *orgsruntime.Server) http.HandlerFunc {
	return send[work.RecordAssessmentRequest](s, pending[work.RecordAssessmentRequest]{
		kind: federationspec.WorkAssessmentKind,
		target: func(r work.RecordAssessmentRequest) (marketplace.EngagementID, work.WorkID) {
			return r.EngagementID, r.WorkID
		},
		payload: func(r work.RecordAssessmentRequest, actor federationspec.WorkActor) any {
			return federationspec.WorkAssessmentPayload{
				WorkActor: actor, Outcome: r.Outcome, Score: r.Score,
				Notes: r.Notes, ReportURL: r.ReportURL,
			}
		},
	})
}

func RecordWorkBackgroundCheckResult(s *orgsruntime.Server) http.HandlerFunc {
	return send[work.RecordBackgroundCheckResultRequest](s, pending[work.RecordBackgroundCheckResultRequest]{
		kind: federationspec.WorkBackgroundCheckResultKind,
		target: func(r work.RecordBackgroundCheckResultRequest) (marketplace.EngagementID, work.WorkID) {
			return r.EngagementID, r.WorkID
		},
		payload: func(r work.RecordBackgroundCheckResultRequest, actor federationspec.WorkActor) any {
			return federationspec.WorkBackgroundCheckResultPayload{
				WorkActor: actor, CheckType: r.CheckType, Outcome: r.Outcome,
				Notes: r.Notes, ReportURL: r.ReportURL,
			}
		},
	})
}
