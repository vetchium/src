package ai

import (
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
)

// OrgAITermsVersion is the AI terms version the portal shows. Enabling AI
// accepts exactly this version; changing the terms text means a new version.
const OrgAITermsVersion = "ai-2026-10"

// MaxDraftInstructionLength bounds a drafting instruction in code points.
const MaxDraftInstructionLength = 4000

// MaxPolicies bounds the policies of one settings request.
const MaxPolicies = 10

type AIAvailability string

const (
	Ready        AIAvailability = "ready"
	NotEnabled   AIAvailability = "not_enabled"
	OperationOff AIAvailability = "operation_off"
	PlanRequired AIAvailability = "plan_required"
	NoCredits    AIAvailability = "no_credits"
)

const defaultLimit = 50
const termsMaxRunes = 64

type GetAIOptionsRequest struct {
	Operation AIOperation `json:"operation"`
}

func (r *GetAIOptionsRequest) Normalize() {}
func (r GetAIOptionsRequest) Validate() []string {
	if !IsAIOperation(r.Operation) {
		return []string{"operation"}
	}
	return nil
}

type AIOptions struct {
	Availability     AIAvailability `json:"availability"`
	Models           []AIModel      `json:"models"`
	DefaultModel     *AIModelOID    `json:"default_model,omitempty"`
	BalanceAvailable int64          `json:"balance_available"`
}

type AIOperationDefault struct {
	Operation    AIOperationOID `json:"operation"`
	DefaultModel AIModelOID     `json:"default_model"`
}

type OrgAISettings struct {
	Enabled              bool                `json:"enabled"`
	AcceptedTermsVersion *string             `json:"accepted_terms_version,omitempty"`
	AcceptedTermsAt      *time.Time          `json:"accepted_terms_at,omitempty"`
	Policies             []AIOperationPolicy `json:"policies"`
}

type AISettingsResponse struct {
	Settings            OrgAISettings        `json:"settings"`
	Models              []AIModel            `json:"models"`
	OperationDefaults   []AIOperationDefault `json:"operation_defaults"`
	CurrentTermsVersion string               `json:"current_terms_version"`
	PlanAllowsAI        bool                 `json:"plan_allows_ai"`
	UnavailableModels   []AIModelOID         `json:"unavailable_models"`
}

type SetAISettingsRequest struct {
	Enabled            bool                `json:"enabled"`
	AcceptTermsVersion *string             `json:"accept_terms_version,omitempty"`
	Policies           []AIOperationPolicy `json:"policies"`
}

func (r *SetAISettingsRequest) Normalize() {}
func (r SetAISettingsRequest) Validate() []string {
	var fields []string
	if r.AcceptTermsVersion != nil {
		length := utf8.RuneCountInString(*r.AcceptTermsVersion)
		if length < 1 || length > termsMaxRunes {
			fields = append(fields, "accept_terms_version")
		}
	}
	if r.Policies == nil || len(r.Policies) > MaxPolicies {
		fields = append(fields, "policies")
		return fields
	}
	seen := make(map[AIOperationOID]bool, len(r.Policies))
	for i, policy := range r.Policies {
		prefix := "policies." + strconv.Itoa(i) + "."
		fields = append(fields, policy.Validate(prefix)...)
		if seen[policy.Operation] {
			fields = append(fields, prefix+"operation")
		}
		seen[policy.Operation] = true
	}
	return fields
}

type AICreditsResponse struct {
	Balance         AICreditBalance `json:"balance"`
	MonthlyGrant    int64           `json:"monthly_grant"`
	PurchaseAllowed bool            `json:"purchase_allowed"`
	Packs           []AICreditPack  `json:"packs"`
}

type ListAICreditLotsRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *common.PageSize      `json:"limit,omitempty"`
}

func (r *ListAICreditLotsRequest) Normalize() {}
func (r ListAICreditLotsRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return defaultLimit
	}
	return *r.Limit
}
func (r ListAICreditLotsRequest) Validate() []string {
	return validatePage(r.PaginationKey, r.EffectiveLimit())
}

type ListAICreditLotsResponse struct {
	Lots              []AICreditLot         `json:"lots"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type BuyAICreditPackRequest struct {
	PackID AICreditPackID `json:"pack_id"`
}

func (r *BuyAICreditPackRequest) Normalize() {}
func (r BuyAICreditPackRequest) Validate() []string {
	if !IsAICreditPackID(r.PackID) {
		return []string{"pack_id"}
	}
	return nil
}

type ListAIUsageRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *common.PageSize      `json:"limit,omitempty"`
}

func (r *ListAIUsageRequest) Normalize() {}
func (r ListAIUsageRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return defaultLimit
	}
	return *r.Limit
}
func (r ListAIUsageRequest) Validate() []string {
	return validatePage(r.PaginationKey, r.EffectiveLimit())
}

type ListAIUsageResponse struct {
	Entries           []AIUsage             `json:"entries"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type GetAIUsageTextRequest struct {
	UsageID AIUsageID `json:"usage_id"`
}

func (r *GetAIUsageTextRequest) Normalize() {}
func (r GetAIUsageTextRequest) Validate() []string {
	if !IsAIUsageID(r.UsageID) {
		return []string{"usage_id"}
	}
	return nil
}

type DraftOpeningRequest struct {
	ModelOID       *AIModelOID            `json:"model_oid,omitempty"`
	Instruction    string                 `json:"instruction"`
	CurrentContent *common.OpeningContent `json:"current_content,omitempty"`
}

func (r *DraftOpeningRequest) Normalize() {
	r.Instruction = strings.TrimSpace(r.Instruction)
	if r.CurrentContent != nil {
		content := *r.CurrentContent
		content.Normalize()
		r.CurrentContent = &content
	}
}

func (r DraftOpeningRequest) Validate() []string {
	var fields []string
	if r.ModelOID != nil && !IsAIModelOID(*r.ModelOID) {
		fields = append(fields, "model_oid")
	}
	length := utf8.RuneCountInString(r.Instruction)
	if length < 1 || length > MaxDraftInstructionLength {
		fields = append(fields, "instruction")
	}
	if r.CurrentContent != nil {
		for _, field := range r.CurrentContent.Validate() {
			fields = append(fields, "current_content."+field)
		}
	}
	return fields
}

type AIUsageCharge struct {
	UsageID        AIUsageID  `json:"usage_id"`
	ModelOID       AIModelOID `json:"model_oid"`
	InputTokens    int32      `json:"input_tokens"`
	OutputTokens   int32      `json:"output_tokens"`
	CreditsCharged int64      `json:"credits_charged"`
}

type DraftOpeningResponse struct {
	Content          common.OpeningContent `json:"content"`
	DroppedFields    []string              `json:"dropped_fields"`
	Usage            AIUsageCharge         `json:"usage"`
	BalanceAvailable int64                 `json:"balance_available"`
}

func validatePage(
	key *common.PaginationKey, limit common.PageSize,
) []string {
	var fields []string
	if key != nil && !common.IsPaginationKey(*key) {
		fields = append(fields, "pagination_key")
	}
	if !common.IsPageSize(limit) {
		fields = append(fields, "limit")
	}
	return fields
}
