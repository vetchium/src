package applications

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
)

// answerRecords judges each answered question against the live content now
// (HP-QST-006). Only what the applicant saw counts: text, type, and options;
// required and number bounds may change without marking an answer changed.
func answerRecords(
	asked []applications.AnsweredQuestion, live []common.ApplicationQuestion,
) []applications.AnswerRecord {
	records := make([]applications.AnswerRecord, len(asked))
	for index, answered := range asked {
		current := applications.AnswerRemoved
		for _, question := range live {
			if question.ID == nil || answered.ID == nil || *question.ID != *answered.ID {
				continue
			}
			current = applications.AnswerChanged
			if question.Text == answered.Text && question.Type == answered.Type &&
				slices.Equal(question.Options, answered.Options) {
				current = applications.AnswerSame
			}
		}
		records[index] = applications.AnswerRecord{
			AnsweredQuestion: answered, Current: current,
		}
	}
	return records
}

// invalidAnswerColumns names each requested column that is not a live
// short-answer question of the Opening (HP-QST-007).
func invalidAnswerColumns(
	columns []common.ApplicationQuestionID, encodedLive []byte,
) ([]string, error) {
	var live []common.ApplicationQuestion
	if err := json.Unmarshal(encodedLive, &live); err != nil {
		return nil, fmt.Errorf("decode live questions: %w", err)
	}
	invalid := []string{}
	for index, id := range columns {
		valid := slices.ContainsFunc(live, func(question common.ApplicationQuestion) bool {
			return question.ID != nil && *question.ID == id &&
				applications.IsAnswerColumnQuestion(question.Type)
		})
		if !valid {
			invalid = append(invalid, fmt.Sprintf("answer_columns.%d", index))
		}
	}
	return invalid, nil
}
