package appconfig

import (
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"time"

	"github.com/vetchium/src/typespec/common"
	aispec "github.com/vetchium/src/typespec/orgs/ai"
)

// AI is the tenant's model catalog and AI credit policy. A tenant without it
// offers no AI, and its portals hide AI features.
type AI struct {
	// RequestTimeout bounds one model call.
	RequestTimeout time.Duration
	// ReservationTimeout is when a reservation whose request never settled
	// is released; it exceeds RequestTimeout so a live call is never reaped.
	ReservationTimeout time.Duration
	// TextRetention is how long prompts and answers are kept.
	TextRetention time.Duration
	// GrantCreditsInterval and ReleaseReservationsInterval pace the workers.
	GrantCreditsInterval        time.Duration
	ReleaseReservationsInterval time.Duration
	Models                      []AIModel
	OperationDefaults           map[aispec.AIOperation]aispec.AIModelOID
	CreditPacks                 []AICreditPack
}

// AIModel is one offered model and the OpenAI-compatible server hosting it.
type AIModel struct {
	OID         aispec.AIModelOID
	DisplayName string
	Vendor      string
	Licence     string
	// WithdrawsAt, when set, marks the model deprecated until then and not
	// offered from then on.
	WithdrawsAt *time.Time
	// BaseURL is the server's API root; the client appends
	// /chat/completions.
	BaseURL   string
	HostModel string
	// APIKeyFile is empty for a server that takes no key.
	APIKeyFile       string
	JSONSchemaOutput bool
	// ChatTemplateKwargs passes model-specific template switches, such as
	// turning off a model's thinking output.
	ChatTemplateKwargs            json.RawMessage
	MaxOutputTokens               int
	InputCreditsPerMillionTokens  int64
	OutputCreditsPerMillionTokens int64
}

type AICreditPack struct {
	ID               aispec.AICreditPackID
	Credits          int64
	PriceCurrency    common.CurrencyCode
	PriceAmountMinor int64
}

// OfferedAt reports whether the model is offered at the instant.
func (m AIModel) OfferedAt(now time.Time) bool {
	return m.WithdrawsAt == nil || now.Before(*m.WithdrawsAt)
}

// APIKey reads the key file; a server without a key yields "".
func (m AIModel) APIKey() (string, error) {
	if m.APIKeyFile == "" {
		return "", nil
	}
	return readTrimmedSecret("AI model API key", m.APIKeyFile)
}

// Model returns the model with the OID, offered or not.
func (a AI) Model(oid aispec.AIModelOID) (AIModel, bool) {
	for _, model := range a.Models {
		if model.OID == oid {
			return model, true
		}
	}
	return AIModel{}, false
}

// Pack returns the pack with the identifier.
func (a AI) Pack(id aispec.AICreditPackID) (AICreditPack, bool) {
	for _, pack := range a.CreditPacks {
		if pack.ID == id {
			return pack, true
		}
	}
	return AICreditPack{}, false
}

type fileAI struct {
	RequestTimeout              string                       `json:"requestTimeout"`
	ReservationTimeout          string                       `json:"reservationTimeout"`
	TextRetention               string                       `json:"textRetention"`
	GrantCreditsInterval        string                       `json:"grantCreditsInterval"`
	ReleaseReservationsInterval string                       `json:"releaseReservationsInterval"`
	Models                      []fileAIModel                `json:"models"`
	OperationDefaults           map[string]aispec.AIModelOID `json:"operationDefaults"`
	CreditPacks                 []fileAICreditPack           `json:"creditPacks"`
}

type fileAIModel struct {
	OID                           aispec.AIModelOID `json:"oid"`
	DisplayName                   string            `json:"displayName"`
	Vendor                        string            `json:"vendor"`
	Licence                       string            `json:"licence"`
	WithdrawsAt                   string            `json:"withdrawsAt"`
	BaseURL                       string            `json:"baseURL"`
	HostModel                     string            `json:"hostModel"`
	APIKeyFile                    string            `json:"apiKeyFile"`
	JSONSchemaOutput              bool              `json:"jsonSchemaOutput"`
	ChatTemplateKwargs            json.RawMessage   `json:"chatTemplateKwargs"`
	MaxOutputTokens               int               `json:"maxOutputTokens"`
	InputCreditsPerMillionTokens  int64             `json:"inputCreditsPerMillionTokens"`
	OutputCreditsPerMillionTokens int64             `json:"outputCreditsPerMillionTokens"`
}

type fileAICreditPack struct {
	ID               aispec.AICreditPackID `json:"id"`
	Credits          int64                 `json:"credits"`
	PriceCurrency    common.CurrencyCode   `json:"priceCurrency"`
	PriceAmountMinor int64                 `json:"priceAmountMinor"`
}

func parseAI(raw fileAI) (AI, error) {
	const prefix = "ai."
	var result AI
	for _, field := range []struct {
		name   string
		value  string
		target *time.Duration
	}{
		{"requestTimeout", raw.RequestTimeout, &result.RequestTimeout},
		{"reservationTimeout", raw.ReservationTimeout, &result.ReservationTimeout},
		{"textRetention", raw.TextRetention, &result.TextRetention},
		{"grantCreditsInterval", raw.GrantCreditsInterval, &result.GrantCreditsInterval},
		{
			"releaseReservationsInterval", raw.ReleaseReservationsInterval,
			&result.ReleaseReservationsInterval,
		},
	} {
		duration, err := positiveDuration(prefix+field.name, field.value)
		if err != nil {
			return AI{}, err
		}
		*field.target = duration
	}
	if result.ReservationTimeout <= result.RequestTimeout {
		return AI{}, fmt.Errorf(
			"%sreservationTimeout must exceed requestTimeout", prefix,
		)
	}
	if len(raw.Models) == 0 {
		return AI{}, fmt.Errorf("%smodels must not be empty", prefix)
	}
	for i, model := range raw.Models {
		parsed, err := parseAIModel(fmt.Sprintf("%smodels[%d].", prefix, i), model)
		if err != nil {
			return AI{}, err
		}
		if _, duplicate := result.Model(parsed.OID); duplicate {
			return AI{}, fmt.Errorf(
				"%smodels: duplicate oid %q", prefix, parsed.OID,
			)
		}
		result.Models = append(result.Models, parsed)
	}
	result.OperationDefaults = make(
		map[aispec.AIOperation]aispec.AIModelOID, len(raw.OperationDefaults),
	)
	for operation, oid := range raw.OperationDefaults {
		if !aispec.IsAIOperation(aispec.AIOperation(operation)) {
			return AI{}, fmt.Errorf(
				"%soperationDefaults: unknown operation %q", prefix, operation,
			)
		}
		model, ok := result.Model(oid)
		// A deprecated default would leave the operation without one once
		// the model is withdrawn.
		if !ok || model.WithdrawsAt != nil {
			return AI{}, fmt.Errorf(
				"%soperationDefaults.%s must name a model offered without a withdrawal date",
				prefix, operation,
			)
		}
		result.OperationDefaults[aispec.AIOperation(operation)] = oid
	}
	for _, operation := range aispec.Operations() {
		if _, ok := result.OperationDefaults[operation]; !ok {
			return AI{}, fmt.Errorf(
				"%soperationDefaults must name a model for %q", prefix, operation,
			)
		}
	}
	for i, pack := range raw.CreditPacks {
		name := fmt.Sprintf("%screditPacks[%d].", prefix, i)
		if !aispec.IsAICreditPackID(pack.ID) {
			return AI{}, fmt.Errorf("%sid must be a lowercase slug", name)
		}
		if _, duplicate := result.Pack(pack.ID); duplicate {
			return AI{}, fmt.Errorf("%sid %q is duplicated", name, pack.ID)
		}
		if pack.Credits < 1 {
			return AI{}, fmt.Errorf("%scredits must be positive", name)
		}
		if !common.IsCurrencyCode(pack.PriceCurrency) {
			return AI{}, fmt.Errorf("%spriceCurrency must be ISO 4217", name)
		}
		if pack.PriceAmountMinor < 0 {
			return AI{}, fmt.Errorf(
				"%spriceAmountMinor must not be negative", name,
			)
		}
		result.CreditPacks = append(result.CreditPacks, AICreditPack(pack))
	}
	currencies := map[common.CurrencyCode]bool{}
	for _, pack := range result.CreditPacks {
		currencies[pack.PriceCurrency] = true
	}
	if len(currencies) > 1 {
		return AI{}, fmt.Errorf(
			"%screditPacks must share the tenant's one currency", prefix,
		)
	}
	return result, nil
}

func parseAIModel(prefix string, raw fileAIModel) (AIModel, error) {
	if !aispec.IsAIModelOID(raw.OID) {
		return AIModel{}, fmt.Errorf("%soid must be a lowercase slug", prefix)
	}
	for _, field := range []struct{ name, value string }{
		{"displayName", raw.DisplayName},
		{"vendor", raw.Vendor},
		{"licence", raw.Licence},
		{"hostModel", raw.HostModel},
	} {
		if err := required(prefix+field.name, field.value); err != nil {
			return AIModel{}, err
		}
	}
	if len(raw.HostModel) > 200 {
		return AIModel{}, fmt.Errorf("%shostModel is too long", prefix)
	}
	base, err := url.Parse(raw.BaseURL)
	if err != nil || base.Host == "" || base.User != nil ||
		(base.Scheme != "http" && base.Scheme != "https") ||
		base.RawQuery != "" || base.Fragment != "" {
		return AIModel{}, fmt.Errorf(
			"%sbaseURL must be an absolute HTTP(S) URL", prefix,
		)
	}
	if raw.MaxOutputTokens < 256 || raw.MaxOutputTokens > 32768 {
		return AIModel{}, fmt.Errorf(
			"%smaxOutputTokens must be between 256 and 32768", prefix,
		)
	}
	if raw.InputCreditsPerMillionTokens < 0 ||
		raw.OutputCreditsPerMillionTokens < 0 {
		return AIModel{}, fmt.Errorf(
			"%scredit rates must not be negative", prefix,
		)
	}
	if len(raw.ChatTemplateKwargs) > 0 {
		var kwargs map[string]any
		if err := json.Unmarshal(raw.ChatTemplateKwargs, &kwargs); err != nil ||
			kwargs == nil {
			return AIModel{}, fmt.Errorf(
				"%schatTemplateKwargs must be a JSON object", prefix,
			)
		}
	}
	model := AIModel{
		OID: raw.OID, DisplayName: raw.DisplayName, Vendor: raw.Vendor,
		Licence: raw.Licence, BaseURL: raw.BaseURL, HostModel: raw.HostModel,
		APIKeyFile:                    raw.APIKeyFile,
		JSONSchemaOutput:              raw.JSONSchemaOutput,
		ChatTemplateKwargs:            slices.Clone(raw.ChatTemplateKwargs),
		MaxOutputTokens:               raw.MaxOutputTokens,
		InputCreditsPerMillionTokens:  raw.InputCreditsPerMillionTokens,
		OutputCreditsPerMillionTokens: raw.OutputCreditsPerMillionTokens,
	}
	if raw.WithdrawsAt != "" {
		withdraws, err := time.Parse(time.RFC3339, raw.WithdrawsAt)
		if err != nil {
			return AIModel{}, fmt.Errorf(
				"%swithdrawsAt must be an RFC 3339 instant", prefix,
			)
		}
		withdraws = withdraws.UTC()
		model.WithdrawsAt = &withdraws
	}
	return model, nil
}
