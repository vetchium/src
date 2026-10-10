package auditlogs

import (
	"encoding/json"
	"slices"
	"strconv"
	"strings"

	auditlogs "github.com/vetchium/src/typespec/admin/audit-logs"
)

// Fail closed: new audit payload fields are not automatically browser-visible.
// Free text, nested objects, identities and correlation tokens are excluded.
func safeDetails(payload []byte) []auditlogs.Detail {
	details := []auditlogs.Detail{}
	var object map[string]json.RawMessage
	if json.Unmarshal(payload, &object) != nil {
		return details
	}
	booleanFields := []string{
		"password_changed", "all_sessions_revoked", "sessions_revoked",
		"email_queued", "code_queued", "message_queued", "was_verified",
		"alias_release_scheduled", "picture_deletion_scheduled",
		"had_supporting_text",
	}
	numberFields := []string{
		"schema_version", "profile_version", "attempt", "attempt_count",
		"consecutive_failures", "consecutive_inconclusive", "notices_queued",
		"emails_queued", "byte_size", "width", "height",
	}
	for field, raw := range object {
		value := ""
		switch {
		case slices.Contains(booleanFields, field):
			var b bool
			if string(raw) != "null" && json.Unmarshal(raw, &b) == nil {
				value = strconv.FormatBool(b)
			}
		case slices.Contains(numberFields, field):
			var n uint64
			if string(raw) != "null" && json.Unmarshal(raw, &n) == nil {
				value = strconv.FormatUint(n, 10)
			}
		case field == "display_name" || field == "previous_display_name":
			var name string
			if json.Unmarshal(raw, &name) == nil && len(name) <= 800 && !strings.Contains(name, "@") {
				value = name
			}
		}
		if value != "" {
			details = append(details, auditlogs.Detail{Field: field, Value: value})
		}
	}
	slices.SortFunc(details, func(a, b auditlogs.Detail) int { return strings.Compare(a.Field, b.Field) })
	return details
}
