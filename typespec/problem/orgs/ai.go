package orgs

import "github.com/vetchium/src/typespec/problem"

var AIUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-unavailable",
	Title:  "AI unavailable",
	Status: 404,
	Detail: "This region offers no AI models",
}

var AINotEnabledError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-not-enabled",
	Title:  "AI not enabled",
	Status: 409,
	Detail: "AI assistance is off for this organization, or its current AI " +
		"terms are not accepted",
}

var AIOperationOffError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-operation-off",
	Title:  "AI operation off",
	Status: 409,
	Detail: "The organization allows no model for this AI operation",
}

// AITermsRequiredDetails is the Go companion of TypeSpec's
// OrgAITermsRequiredDetails.
type AITermsRequiredDetails struct {
	problem.Details
	TermsVersion string `json:"terms_version"`
}

func AITermsRequiredError(termsVersion string) AITermsRequiredDetails {
	return AITermsRequiredDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-ai-terms-required",
			Title:  "AI terms required",
			Status: 422,
			Detail: "Turning AI assistance on requires accepting the current " +
				"AI terms",
		},
		TermsVersion: termsVersion,
	}
}

// AIModelNotOfferedDetails is the Go companion of TypeSpec's
// OrgAIModelNotOfferedDetails.
type AIModelNotOfferedDetails struct {
	problem.Details
	ModelOIDs []string `json:"model_oids"`
}

func AIModelNotOfferedError(modelOIDs []string) AIModelNotOfferedDetails {
	return AIModelNotOfferedDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-ai-model-not-offered",
			Title:  "AI model not offered",
			Status: 422,
			Detail: "This region does not offer one or more of the requested " +
				"models",
		},
		ModelOIDs: modelOIDs,
	}
}

var AIModelNotAllowedError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-model-not-allowed",
	Title:  "AI model not allowed",
	Status: 422,
	Detail: "The organization does not allow that model for this AI operation",
}

// AICreditsInsufficientDetails is the Go companion of TypeSpec's
// OrgAICreditsInsufficientDetails.
type AICreditsInsufficientDetails struct {
	problem.Details
	Required  int64 `json:"required"`
	Available int64 `json:"available"`
}

func AICreditsInsufficientError(
	required, available int64,
) AICreditsInsufficientDetails {
	return AICreditsInsufficientDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-ai-credits-insufficient",
			Title:  "AI credits insufficient",
			Status: 409,
			Detail: "The organization has too few AI credits for this request",
		},
		Required:  required,
		Available: available,
	}
}

var AIRequestInProgressError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-request-in-progress",
	Title:  "AI request in progress",
	Status: 409,
	Detail: "A request with this idempotency key is still running",
}

var AIModelFailedError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-model-failed",
	Title:  "AI model failed",
	Status: 503,
	Detail: "The AI model did not answer. No credits were charged.",
}

var AIOutputUnusableError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-output-unusable",
	Title:  "AI output unusable",
	Status: 502,
	Detail: "The AI model's answer could not be used. No credits were charged.",
}

var AIPackNotOfferedError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-pack-not-offered",
	Title:  "AI credit pack not offered",
	Status: 422,
	Detail: "This region does not offer that AI credit pack",
}

var AIUsageNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-ai-usage-not-found",
	Title:  "AI usage not found",
	Status: 404,
	Detail: "No readable AI usage text has that identifier",
}
