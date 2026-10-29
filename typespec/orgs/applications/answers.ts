import {
  type ApplicationQuestion,
  type ApplicationQuestionID,
  type ApplicationQuestionType,
  isApplicationQuestionID,
  maxApplicationQuestions,
  maxQuestionOptions,
  QuestionMultipleChoice,
  QuestionNumber,
  QuestionSingleChoice,
  QuestionYesNo,
} from "../../common/openings.ts";
import {
  type FeedbackCriterion,
  type FeedbackCriterionID,
  isFeedbackCriterionID,
  maxFeedbackCriteria,
} from "../hiring/pipelines.ts";

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

export const AnswerSame = "same" as const;
export const AnswerChanged = "changed" as const;
export const AnswerRemoved = "removed" as const;
/** How an answered question compares to the live one now (HP-QST-006). */
export type AnswerCurrency =
  | typeof AnswerSame
  | typeof AnswerChanged
  | typeof AnswerRemoved
  | (string & {});

export interface AnswerRecord extends AnsweredQuestion {
  current: AnswerCurrency;
}

/** The most `answer_columns` a list request names (HP-QST-007). */
export const maxAnswerColumns = 3;

/** Short answers only; free text never becomes a list column. */
export function isAnswerColumnQuestion(type: ApplicationQuestionType): boolean {
  return (
    type === QuestionNumber ||
    type === QuestionYesNo ||
    type === QuestionSingleChoice ||
    type === QuestionMultipleChoice
  );
}

export const maxCriteriaAnswers = maxFeedbackCriteria;
export const maxCriterionTextValue = 2000;
export const minCriterionRating = 1;
export const maxCriterionRating = 5;

/** The criterion's type decides which kind is valid (HP-FRM-003). */
export type CriterionAnswerValue = number | boolean | string;

export interface CriterionAnswer {
  criterion_id: FeedbackCriterionID;
  value: CriterionAnswerValue;
}

/** Returns trimmed copies. */
export function normalizeCriteriaAnswers(
  answers: CriterionAnswer[],
): CriterionAnswer[] {
  return answers.map(({ criterion_id, value }) => ({
    criterion_id,
    value: typeof value === "string" ? value.trim() : value,
  }));
}

function isCriterionAnswerValue(value: unknown): boolean {
  if (typeof value === "string")
    return codePoints(value) <= maxCriterionTextValue;
  if (typeof value === "number") return Number.isSafeInteger(value);
  return typeof value === "boolean";
}

/** Checks only shape and lengths; the stage's form decides the rest. */
export function validateCriteriaAnswerShapes(
  answers: CriterionAnswer[],
): string[] {
  const fields: string[] = [];
  if (answers.length > maxCriteriaAnswers) fields.push("criteria_answers");
  answers.forEach((answer, index) => {
    if (!isFeedbackCriterionID(answer.criterion_id))
      fields.push(`criteria_answers.${index}.criterion_id`);
    if (!isCriterionAnswerValue(answer.value))
      fields.push(`criteria_answers.${index}.value`);
  });
  return fields;
}

/**
 * A criterion as asked, with the answer (absent when an optional one went
 * unanswered) and its currency against the stage's form now (HP-FRM-004).
 */
export interface AnsweredCriterion extends FeedbackCriterion {
  answer?: CriterionAnswerValue;
  current: AnswerCurrency;
}
