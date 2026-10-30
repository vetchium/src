import {
  type ApplicationQuestion,
  QuestionLongText,
  QuestionMultipleChoice,
  QuestionNumber,
  QuestionShortText,
  QuestionSingleChoice,
  QuestionYesNo,
} from "typespec/common/openings";
import type {
  ApplicationAnswer,
  ApplicationAnswerValue,
} from "typespec/orgs/applications/answers";

/** Form values by question id; absent or blank means unanswered. */
export type AnswerValues = Partial<
  Record<string, ApplicationAnswerValue | null>
>;

export function blankAnswer(
  value: ApplicationAnswerValue | null | undefined,
): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Whether a kept value still suits the question, after the Org edited it. */
export function answerFits(
  question: ApplicationQuestion,
  value: ApplicationAnswerValue | null | undefined,
): boolean {
  if (blankAnswer(value)) return true;
  switch (question.type) {
    case QuestionShortText:
    case QuestionLongText:
      return typeof value === "string";
    case QuestionNumber:
      return typeof value === "number";
    case QuestionYesNo:
      return typeof value === "boolean";
    case QuestionSingleChoice:
      return typeof value === "string" && !!question.options?.includes(value);
    case QuestionMultipleChoice:
      return (
        Array.isArray(value) &&
        value.every((option) => question.options?.includes(option))
      );
    default:
      return false;
  }
}

/** The answers to send, in question order; blank optional answers are left
 * out (HP-QST-004). */
export function answersFor(
  questions: readonly ApplicationQuestion[],
  values: AnswerValues,
): ApplicationAnswer[] {
  return questions.flatMap((question) => {
    const value = question.id === undefined ? undefined : values[question.id];
    if (question.id === undefined || value === undefined || value === null)
      return [];
    if (blankAnswer(value)) return [];
    return [
      {
        question_id: question.id,
        value: typeof value === "string" ? value.trim() : value,
      },
    ];
  });
}
