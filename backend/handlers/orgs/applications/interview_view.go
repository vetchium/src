package applications

import (
	"encoding/json"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/applications"

	"backend/internal/applicationview"
)

// interviews decodes the interviews GetOrgApplication aggregated.
func interviews(stored json.RawMessage) ([]applications.Interview, error) {
	return applicationview.Interviews(stored)
}

func interviewNumber(number pgtype.Int4) *applications.InterviewNumber {
	if !number.Valid {
		return nil
	}
	value := applications.InterviewNumber(number.Int32)
	return &value
}
