// Package orgai holds the Org side of AI assistance: which models an Org may
// use for an operation, whether it may run one now, and each operation's
// prompt and output handling. Credits and calls are metered by the handlers.
package orgai

import (
	"context"
	"slices"
	"time"

	aispec "github.com/vetchium/src/typespec/orgs/ai"
	"github.com/vetchium/src/typespec/orgs/authorization"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/aicredits"
	"backend/internal/appconfig"
	"backend/internal/chatmodel"
	"backend/internal/orgs/entitlements"
)

// Completer runs one model call; tests replace the HTTP client with it.
type Completer interface {
	Complete(
		context.Context, chatmodel.Endpoint, chatmodel.Request,
	) (chatmodel.Response, error)
}

// Runtime is a tenant's AI catalog with the means to call its models. A nil
// Runtime means the tenant offers no AI.
type Runtime struct {
	Config  appconfig.AI
	Client  Completer
	apiKeys map[aispec.AIModelOID]string
}

func NewRuntime(config appconfig.AI, client Completer) (*Runtime, error) {
	keys := make(map[aispec.AIModelOID]string, len(config.Models))
	for _, model := range config.Models {
		key, err := model.APIKey()
		if err != nil {
			return nil, err
		}
		keys[model.OID] = key
	}
	return &Runtime{Config: config, Client: client, apiKeys: keys}, nil
}

func (r *Runtime) Endpoint(model appconfig.AIModel) chatmodel.Endpoint {
	return chatmodel.Endpoint{
		BaseURL: model.BaseURL, APIKey: r.apiKeys[model.OID],
		HostModel: model.HostModel, ChatTemplateKwargs: model.ChatTemplateKwargs,
		JSONSchemaOutput: model.JSONSchemaOutput,
	}
}

// Offered lists the models offered at the instant, in configuration order.
func (r *Runtime) Offered(now time.Time) []appconfig.AIModel {
	offered := make([]appconfig.AIModel, 0, len(r.Config.Models))
	for _, model := range r.Config.Models {
		if model.OfferedAt(now) {
			offered = append(offered, model)
		}
	}
	return offered
}

// OfferedModel returns the model when it is offered at the instant.
func (r *Runtime) OfferedModel(
	oid aispec.AIModelOID, now time.Time,
) (appconfig.AIModel, bool) {
	model, ok := r.Config.Model(oid)
	if !ok || !model.OfferedAt(now) {
		return appconfig.AIModel{}, false
	}
	return model, true
}

func Rates(model appconfig.AIModel) aicredits.Rates {
	return aicredits.Rates{
		InputPerMillion:  model.InputCreditsPerMillionTokens,
		OutputPerMillion: model.OutputCreditsPerMillionTokens,
	}
}

func ModelView(model appconfig.AIModel) aispec.AIModel {
	status := aispec.Offered
	if model.WithdrawsAt != nil {
		status = aispec.Deprecated
	}
	return aispec.AIModel{
		ModelOID: model.OID, DisplayName: model.DisplayName,
		Vendor: model.Vendor, Licence: model.Licence, Status: status,
		WithdrawsAt:                   model.WithdrawsAt,
		InputCreditsPerMillionTokens:  model.InputCreditsPerMillionTokens,
		OutputCreditsPerMillionTokens: model.OutputCreditsPerMillionTokens,
	}
}

// Policy is an Org's stored choice for one operation.
type Policy struct {
	AllowedModels []aispec.AIModelOID
	DefaultModel  aispec.AIModelOID
}

// Effective resolves what an operation may use now. Without a stored policy
// every offered model is allowed. A stored policy keeps its offered models;
// when its default is withdrawn, the region default takes its place.
func (r *Runtime) Effective(
	operation aispec.AIOperation, stored *Policy, now time.Time,
) ([]appconfig.AIModel, *aispec.AIModelOID) {
	regionDefault := r.Config.OperationDefaults[operation]
	if stored == nil {
		offered := r.Offered(now)
		if _, ok := r.OfferedModel(regionDefault, now); !ok {
			return offered, nil
		}
		return offered, &regionDefault
	}
	allowed := make([]appconfig.AIModel, 0, len(stored.AllowedModels))
	for _, model := range r.Offered(now) {
		if slices.Contains(stored.AllowedModels, model.OID) {
			allowed = append(allowed, model)
		}
	}
	choice := stored.DefaultModel
	if _, ok := r.OfferedModel(choice, now); !ok {
		choice = regionDefault
		model, offered := r.OfferedModel(choice, now)
		if !offered {
			return allowed, nil
		}
		if !slices.ContainsFunc(allowed, func(m appconfig.AIModel) bool {
			return m.OID == choice
		}) {
			allowed = append(allowed, model)
		}
	}
	return allowed, &choice
}

// OperationPermission is what running the operation requires.
func OperationPermission(
	operation aispec.AIOperation,
) (authorization.OrgPermission, bool) {
	switch operation {
	case aispec.OpeningDraft:
		return authorization.ManageOpenings, true
	default:
		return "", false
	}
}

// TextReadPermission is what reading a call's kept text requires besides
// org:manage_ai: the permission that reads what the operation worked on. An
// operation this version does not know is readable by nobody.
func TextReadPermission(
	operation aispec.AIOperationOID,
) (authorization.OrgPermission, bool) {
	switch aispec.AIOperation(operation) {
	case aispec.OpeningDraft:
		return authorization.ViewOpenings, true
	default:
		return "", false
	}
}

// AIPlanOIDs are the plans that include AI, for gated statements.
func AIPlanOIDs() []string {
	return entitlements.PlanOIDs(subscriptionspec.AllowsAI)
}

// Standing is what decides whether an Org may run an operation now.
type Standing struct {
	Enabled      bool
	TermsCurrent bool
	PlanAllowsAI bool
	Balance      aispec.AICreditBalance
}

func (s Standing) Availability() aispec.AIAvailability {
	switch {
	case !s.Enabled || !s.TermsCurrent:
		return aispec.NotEnabled
	case !s.PlanAllowsAI && s.Balance.PurchasedRemaining == 0:
		return aispec.PlanRequired
	case s.Balance.Available <= 0:
		return aispec.NoCredits
	default:
		return aispec.Ready
	}
}

// Balance derives the reported balance. A grant counts only while the plan
// allows AI; the query already excludes it otherwise.
func Balance(
	grantRemaining, purchasedRemaining, reserved int64,
	grantExpiresAt *time.Time,
) aispec.AICreditBalance {
	return aispec.AICreditBalance{
		Available:             max(grantRemaining+purchasedRemaining-reserved, 0),
		MonthlyGrantRemaining: grantRemaining,
		MonthlyGrantExpiresAt: grantExpiresAt,
		PurchasedRemaining:    purchasedRemaining,
		Reserved:              reserved,
	}
}
