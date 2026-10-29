import "../../common/openings.tsp";
import "../hiring/pipelines.tsp";

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

/**
 * How an answered question compares to the live question with its id now
 * (HP-QST-006): `same` text, type, and options; `changed` in any of them; or
 * `removed` from the live content.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["same", "changed", "removed"]
)
scalar AnswerCurrency extends string;

/** An answered question as asked, with its currency for Org readers. */
model AnswerRecord {
  ...AnsweredQuestion;
  current: AnswerCurrency;
}

/**
 * An integer 1–5 for `rating`, a boolean for `yes_no`, and a trimmed string
 * of 1–2,000 code points for `text` (HP-FRM-003).
 */
union CriterionAnswerValue {
  int64,
  boolean,
  string,
}

/** An interviewer's answer to one criterion of the stage's form. */
model CriterionAnswer {
  criterion_id: Vetchium.Orgs.Hiring.FeedbackCriterionID;
  value: CriterionAnswerValue;
}

/**
 * One criterion as the interviewer was asked it, with their answer (absent
 * for an unanswered optional criterion) and its currency against the stage's
 * form now: `removed` when the stage no longer has the criterion
 * (HP-FRM-004). Only text and type count; `required` may change freely.
 */
model AnsweredCriterion {
  ...Vetchium.Orgs.Hiring.FeedbackCriterion;
  answer?: CriterionAnswerValue;
  current: AnswerCurrency;
}
