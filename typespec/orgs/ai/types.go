// Package ai contains Org AI wire types.
package ai

import (
	"regexp"
	"slices"
	"time"

	"github.com/vetchium/src/typespec/common"
)

type AIModelOID string
type AIOperation string
type AIOperationOID string
type AICreditPackID string
type AIUsageID string
type AIModelStatus string
type AICreditLotKind string
type AIUsageState string
type AIFailureReason string
type AIMessageRole string

const OpeningDraft AIOperation = "org-opening-draft"

const (
	Offered    AIModelStatus = "offered"
	Deprecated AIModelStatus = "deprecated"

	GrantLot    AICreditLotKind = "grant"
	PurchaseLot AICreditLotKind = "purchase"

	Reserved  AIUsageState = "reserved"
	Settled   AIUsageState = "settled"
	Released  AIUsageState = "released"
	Abandoned AIUsageState = "abandoned"

	ModelFailed      AIFailureReason = "model_failed"
	UnusableOutput   AIFailureReason = "unusable_output"
	AbandonedFailure AIFailureReason = "abandoned"

	SystemRole AIMessageRole = "system"
	UserRole   AIMessageRole = "user"
)

// MaxAllowedModels bounds one operation's allowed models.
const MaxAllowedModels = 20

var operations = []AIOperation{OpeningDraft}

// Operations returns every operation this contract version defines.
func Operations() []AIOperation {
	return slices.Clone(operations)
}

func IsAIOperation(value AIOperation) bool {
	return slices.Contains(operations, value)
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

func IsAIModelOID(value AIModelOID) bool {
	return len(value) >= 1 && len(value) <= 64 &&
		slugPattern.MatchString(string(value))
}

func IsAICreditPackID(value AICreditPackID) bool {
	return len(value) >= 1 && len(value) <= 64 &&
		slugPattern.MatchString(string(value))
}

var uuidPattern = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// IsAIUsageID accepts the lowercase form the API returns.
func IsAIUsageID(value AIUsageID) bool {
	return uuidPattern.MatchString(string(value))
}

type AIModel struct {
	ModelOID                      AIModelOID    `json:"model_oid"`
	DisplayName                   string        `json:"display_name"`
	Vendor                        string        `json:"vendor"`
	Licence                       string        `json:"licence"`
	Status                        AIModelStatus `json:"status"`
	WithdrawsAt                   *time.Time    `json:"withdraws_at,omitempty"`
	InputCreditsPerMillionTokens  int64         `json:"input_credits_per_million_tokens"`
	OutputCreditsPerMillionTokens int64         `json:"output_credits_per_million_tokens"`
}

type AIOperationPolicy struct {
	Operation     AIOperationOID `json:"operation"`
	AllowedModels []AIModelOID   `json:"allowed_models"`
	DefaultModel  *AIModelOID    `json:"default_model,omitempty"`
}

// Off reports a policy that allows no model, which turns the operation off.
func (p AIOperationPolicy) Off() bool { return len(p.AllowedModels) == 0 }

// Validate reports the policy's invalid fields, prefixed for its position in
// a request.
func (p AIOperationPolicy) Validate(prefix string) []string {
	var fields []string
	if !IsAIOperation(AIOperation(p.Operation)) {
		fields = append(fields, prefix+"operation")
	}
	seen := make(map[AIModelOID]bool, len(p.AllowedModels))
	valid := p.AllowedModels != nil &&
		len(p.AllowedModels) <= MaxAllowedModels
	for _, model := range p.AllowedModels {
		if !IsAIModelOID(model) || seen[model] {
			valid = false
		}
		seen[model] = true
	}
	if !valid {
		fields = append(fields, prefix+"allowed_models")
	}
	if p.Off() {
		if p.DefaultModel != nil {
			fields = append(fields, prefix+"default_model")
		}
	} else if p.DefaultModel == nil || !IsAIModelOID(*p.DefaultModel) ||
		!seen[*p.DefaultModel] {
		fields = append(fields, prefix+"default_model")
	}
	return fields
}

type AICreditBalance struct {
	Available              int64      `json:"available"`
	MonthlyGrantRemaining  int64      `json:"monthly_grant_remaining"`
	MonthlyGrantTotal      int64      `json:"monthly_grant_total"`
	MonthlyGrantExpiresAt  *time.Time `json:"monthly_grant_expires_at,omitempty"`
	PurchasedRemaining     int64      `json:"purchased_remaining"`
	PurchasedTotal         int64      `json:"purchased_total"`
	PurchasedNextExpiresAt *time.Time `json:"purchased_next_expires_at,omitempty"`
	Reserved               int64      `json:"reserved"`
}

type AICreditPack struct {
	PackID           AICreditPackID      `json:"pack_id"`
	Credits          int64               `json:"credits"`
	PriceCurrency    common.CurrencyCode `json:"price_currency"`
	PriceAmountMinor int64               `json:"price_amount_minor"`
}

type AICreditLot struct {
	Kind             AICreditLotKind `json:"kind"`
	CreditsGranted   int64           `json:"credits_granted"`
	CreditsRemaining int64           `json:"credits_remaining"`
	PackID           *AICreditPackID `json:"pack_id,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	ExpiresAt        time.Time       `json:"expires_at"`
}

type AIUsage struct {
	UsageID        AIUsageID           `json:"usage_id"`
	Operation      AIOperationOID      `json:"operation"`
	ModelOID       AIModelOID          `json:"model_oid"`
	ActorEmail     common.EmailAddress `json:"actor_email"`
	State          AIUsageState        `json:"state"`
	FailureReason  *AIFailureReason    `json:"failure_reason,omitempty"`
	InputTokens    *int32              `json:"input_tokens,omitempty"`
	OutputTokens   *int32              `json:"output_tokens,omitempty"`
	CreditsCharged int64               `json:"credits_charged"`
	CreatedAt      time.Time           `json:"created_at"`
	TextAvailable  bool                `json:"text_available"`
}

type AIMessage struct {
	Role    AIMessageRole `json:"role"`
	Content string        `json:"content"`
}

type AIUsageText struct {
	UsageID         AIUsageID   `json:"usage_id"`
	RequestMessages []AIMessage `json:"request_messages"`
	ResponseText    *string     `json:"response_text,omitempty"`
	ExpiresAt       time.Time   `json:"expires_at"`
}
