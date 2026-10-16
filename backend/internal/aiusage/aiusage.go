// Package aiusage presents the Org AI usage ledger the same way to the Orgs
// and Admin APIs.
package aiusage

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	aispec "github.com/vetchium/src/typespec/orgs/ai"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

func Entry(row sqlc.ListOrgAIUsageRow) aispec.AIUsage {
	entry := aispec.AIUsage{
		UsageID:        aispec.AIUsageID(dbvalue.FormatUUID(row.UsageID)),
		Operation:      aispec.AIOperationOID(row.Operation),
		ModelOID:       aispec.AIModelOID(row.ModelOid),
		ActorEmail:     common.EmailAddress(row.ActorEmail),
		State:          aispec.AIUsageState(row.UsageState),
		CreditsCharged: row.CreditsCharged,
		CreatedAt:      row.CreatedAt.Time.UTC(),
		TextAvailable:  row.TextAvailable,
	}
	if row.FailureReason.Valid {
		reason := aispec.AIFailureReason(row.FailureReason.VetchiumOrgAiFailureReason)
		entry.FailureReason = &reason
	}
	if row.InputTokens.Valid {
		entry.InputTokens = &row.InputTokens.Int32
	}
	if row.OutputTokens.Valid {
		entry.OutputTokens = &row.OutputTokens.Int32
	}
	return entry
}

func Text(
	usageID string, messages []byte, response pgtype.Text,
	expiresAt pgtype.Timestamptz,
) (aispec.AIUsageText, error) {
	text := aispec.AIUsageText{
		UsageID:   aispec.AIUsageID(usageID),
		ExpiresAt: expiresAt.Time.UTC(),
	}
	if err := json.Unmarshal(messages, &text.RequestMessages); err != nil {
		return aispec.AIUsageText{}, fmt.Errorf("decode kept messages: %w", err)
	}
	if response.Valid {
		text.ResponseText = &response.String
	}
	return text, nil
}

// cursor resumes a newest-first usage list after its last row. Scope binds
// the key to the list it came from, such as one Org's domain.
type cursor struct {
	AfterCreatedAt time.Time `json:"after_created_at"`
	AfterUsageID   string    `json:"after_usage_id"`
	Scope          string    `json:"scope"`
}

func EncodeCursor(
	key [32]byte, purpose, scope string, last sqlc.ListOrgAIUsageRow,
) (common.PaginationKey, error) {
	payload, err := json.Marshal(cursor{
		AfterCreatedAt: last.CreatedAt.Time.UTC(),
		AfterUsageID:   dbvalue.FormatUUID(last.UsageID),
		Scope:          scope,
	})
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(key, purpose, payload)), nil
}

// DecodeCursor reports false for a key that is forged, from another list, or
// malformed.
func DecodeCursor(
	key [32]byte, purpose, scope string, value common.PaginationKey,
) (pgtype.Timestamptz, pgtype.UUID, bool) {
	payload, valid := credentials.VerifySignedValue(key, purpose, string(value))
	var decoded cursor
	if !valid || json.Unmarshal(payload, &decoded) != nil ||
		decoded.Scope != scope || decoded.AfterCreatedAt.IsZero() {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	id, err := dbvalue.ParseUUID(decoded.AfterUsageID)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	return dbvalue.Timestamp(decoded.AfterCreatedAt), id, true
}
