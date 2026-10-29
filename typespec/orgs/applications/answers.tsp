import "../../common/openings.tsp";

namespace Vetchium.Orgs.Applications;

/**
 * A trimmed string for `short_text` (1–200 code points) and `long_text`
 * (1–2,000), an integer for `number`, a boolean for `yes_no`, one option's
 * exact text for `single_choice`, and 1–8 unique options for
 * `multiple_choice` (HP-QST-004). Any string holds at most 2,000 code points
 * and a list at most 8 strings.
 */
union ApplicationAnswerValue {
  string,
  int64,
  boolean,
  string[],
}

/** The applicant's answer to one live question of the Opening. */
model ApplicationAnswer {
  question_id: Vetchium.ApplicationQuestionID;
  value: ApplicationAnswerValue;
}

/**
 * One question as the application was asked it, with the applicant's answer;
 * `answer` is absent for an unanswered optional question (HP-QST-005).
 */
model AnsweredQuestion {
  ...Vetchium.ApplicationQuestion;
  answer?: ApplicationAnswerValue;
}
