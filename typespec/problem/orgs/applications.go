package orgs

import (
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/problem"
)

var ApplicationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-application-not-found",
	Title:  "Org application not found",
	Status: 404,
	Detail: "No readable application has the requested number",
}

var ApplicationVersionConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-application-version-conflict",
	Title:  "Org application version conflict",
	Status: 409,
	Detail: "The application changed since it was read",
}

var ApplicationStateConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-application-state-conflict",
	Title:  "Org application state conflict",
	Status: 409,
	Detail: "The action is not allowed in the application's current state",
}

var OfferLetterTooLargeError = problem.Details{
	Type:   "vetchium-problem-details/org-offer-letter-too-large",
	Title:  "Org offer letter too large",
	Status: 413,
	Detail: "The offer letter exceeds the five-mebibyte limit",
}

var OfferLetterInvalidError = problem.Details{
	Type:   "vetchium-problem-details/org-offer-letter-invalid",
	Title:  "Invalid Org offer letter",
	Status: 400,
	Detail: "The offer letter is not a PDF",
}

var OfferLetterConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-offer-letter-conflict",
	Title:  "Org offer letter conflict",
	Status: 409,
	Detail: "The upload was superseded or expired before it completed",
}

var InterviewNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-interview-not-found",
	Title:  "Org interview not found",
	Status: 404,
	Detail: "The application has no interview with the requested number",
}

var InterviewStateConflictError = problem.Details{
	Type:   "vetchium-problem-details/org-interview-state-conflict",
	Title:  "Org interview state conflict",
	Status: 409,
	Detail: "The action is not allowed in the interview's current state or time",
}

var InterviewFeedbackExistsError = problem.Details{
	Type:   "vetchium-problem-details/org-interview-feedback-exists",
	Title:  "Org interview feedback exists",
	Status: 409,
	Detail: "The caller already submitted feedback on the interview",
}

// InterviewFeedbackAnswersInvalidType is the type of the HP-FRM-003 refusal.
const InterviewFeedbackAnswersInvalidType = "vetchium-problem-details/org-interview-feedback-answers-invalid"

type InterviewFeedbackAnswersInvalidDetails struct {
	problem.Details
	CriterionIDs []hiring.FeedbackCriterionID `json:"criterion_ids"`
}

func InterviewFeedbackAnswersInvalidError(
	criterionIDs []hiring.FeedbackCriterionID,
) InterviewFeedbackAnswersInvalidDetails {
	return InterviewFeedbackAnswersInvalidDetails{
		Details: problem.Details{
			Type:   InterviewFeedbackAnswersInvalidType,
			Title:  "Org interview feedback answers invalid",
			Status: 422,
			Detail: "The criteria answers do not fit the stage's feedback form",
		},
		CriterionIDs: criterionIDs,
	}
}

type InterviewLimitReachedDetails struct {
	problem.Details
	Limit int32 `json:"limit"`
}

func InterviewLimitReachedError(limit int32) InterviewLimitReachedDetails {
	return InterviewLimitReachedDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-interview-limit-reached",
			Title:  "Org interview limit reached",
			Status: 409,
			Detail: "The candidacy already has the most interviews it may hold at this stage",
		},
		Limit: limit,
	}
}

type InterviewInterviewersInvalidDetails struct {
	problem.Details
	EmailAddresses []string `json:"email_addresses"`
}

func InterviewInterviewersInvalidError(addresses []string) InterviewInterviewersInvalidDetails {
	return InterviewInterviewersInvalidDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-interview-interviewers-invalid",
			Title:  "Org interview interviewers invalid",
			Status: 422,
			Detail: "A named interviewer is not an active user of the Org",
		},
		EmailAddresses: addresses,
	}
}
