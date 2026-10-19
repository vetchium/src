package applications

import (
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/applications"
)

// interviews decodes the interviews GetOrgApplication aggregated. The query
// already applied the feedback visibility rule (HP-WRK-004), so nothing here
// filters again.
func interviews(stored json.RawMessage) ([]applications.Interview, error) {
	list := []applications.Interview{}
	if err := json.Unmarshal(stored, &list); err != nil {
		return nil, fmt.Errorf("decode interviews: %w", err)
	}
	for index := range list {
		list[index].StartsAt = list[index].StartsAt.UTC()
		for feedback := range list[index].Feedback {
			list[index].Feedback[feedback].SubmittedAt =
				list[index].Feedback[feedback].SubmittedAt.UTC()
		}
		if list[index].Interviewers == nil {
			list[index].Interviewers = []applications.InterviewerStatus{}
		}
		if list[index].Feedback == nil {
			list[index].Feedback = []applications.InterviewFeedback{}
		}
	}
	return list, nil
}

func interviewNumber(number pgtype.Int4) *applications.InterviewNumber {
	if !number.Valid {
		return nil
	}
	value := applications.InterviewNumber(number.Int32)
	return &value
}
