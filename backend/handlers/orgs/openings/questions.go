package openings

import (
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/dbvalue"
)

// withQuestionIDs gives every new question an id and returns those ids. Ids
// a caller sent are checked against the Opening by the write statement
// (HP-QST-002).
func withQuestionIDs(content common.OpeningContent, now time.Time) (common.OpeningContent, []string, error) {
	assigned := []string{}
	if content.Questions == nil {
		return content, assigned, nil
	}
	questions := slices.Clone(content.Questions)
	for index := range questions {
		if questions[index].ID != nil {
			continue
		}
		id, err := dbvalue.NewUUIDv7(now)
		if err != nil {
			return content, nil, err
		}
		value := common.ApplicationQuestionID(dbvalue.FormatUUID(id))
		questions[index].ID = &value
		assigned = append(assigned, string(value))
	}
	content.Questions = questions
	return content, assigned, nil
}

// unknownQuestions turns the statement's 1-based positions of question ids
// the Opening does not hold into a validation problem, or nil when none.
func unknownQuestions(encoded []byte) (*problem.Details, error) {
	var positions []int
	if err := json.Unmarshal(encoded, &positions); err != nil {
		return nil, fmt.Errorf("decode unknown question positions: %w", err)
	}
	if len(positions) == 0 {
		return nil, nil
	}
	details := problem.ValidationFailedError
	details.Fields = make([]string, len(positions))
	for index, position := range positions {
		details.Fields[index] = fmt.Sprintf("content.questions.%d.id", position-1)
	}
	return &details, nil
}
