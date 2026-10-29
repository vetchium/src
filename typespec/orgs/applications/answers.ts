import {
  type ApplicationQuestion,
  type ApplicationQuestionID,
  isApplicationQuestionID,
  maxApplicationQuestions,
  maxQuestionOptions,
} from "../../common/openings.ts";

export const maxApplicationAnswers = maxApplicationQuestions;
export const maxShortTextAnswer = 200;
export const maxLongTextAnswer = 2000;
export const maxAnswerOptions = maxQuestionOptions;

/** The question's type decides which kind is valid (HP-QST-004). */
export type ApplicationAnswerValue = string | number | boolean | string[];

export interface ApplicationAnswer {
  question_id: ApplicationQuestionID;
  value: ApplicationAnswerValue;
}

/** `answer` is absent for an unanswered optional question (HP-QST-005). */
export interface AnsweredQuestion extends ApplicationQuestion {
  answer?: ApplicationAnswerValue;
}

/** Returns trimmed copies. */
export function normalizeAnswers(
  answers: ApplicationAnswer[],
): ApplicationAnswer[] {
  return answers.map(({ question_id, value }) => ({
    question_id,
    value:
      typeof value === "string"
        ? value.trim()
        : Array.isArray(value)
          ? value.map((option) => option.trim())
          : value,
  }));
}

const codePoints = (value: string) => [...value].length;

function isAnswerValue(value: unknown): boolean {
  if (typeof value === "string") return codePoints(value) <= maxLongTextAnswer;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (typeof value === "boolean") return true;
  return (
    Array.isArray(value) &&
    value.length <= maxAnswerOptions &&
    value.every(
      (option) =>
        typeof option === "string" && codePoints(option) <= maxLongTextAnswer,
    )
  );
}

/**
 * Checks only shape and lengths; the Org tenant checks answers against the
 * live questions (HP-QST-004).
 */
export function validateAnswerShapes(answers: ApplicationAnswer[]): string[] {
  const fields: string[] = [];
  if (answers.length > maxApplicationAnswers) fields.push("answers");
  answers.forEach((answer, index) => {
    if (!isApplicationQuestionID(answer.question_id))
      fields.push(`answers.${index}.question_id`);
    if (!isAnswerValue(answer.value)) fields.push(`answers.${index}.value`);
  });
  return fields;
}
