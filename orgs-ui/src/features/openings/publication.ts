import type { TFunction } from "i18next";
import {
  type ApplicationQuestion,
  isChoiceQuestion,
  missingForPublication,
  QuestionNumber,
} from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";

const contentLabelKeys: Readonly<Record<string, string>> = {
  title: "openings.fields.title",
  description: "openings.fields.description",
  language: "openings.fields.language",
  employing_country: "openings.fields.country",
  work_arrangement: "openings.fields.workArrangement",
  location_details: "openings.fields.locationDetails",
  remote_eligibility: "openings.fields.remoteEligibility",
  employment_type: "openings.fields.employmentType",
  positions: "openings.fields.positions",
  experience_years: "openings.fields.experienceYears",
  minimum_education: "openings.fields.minimumEducation",
  salary: "openings.fields.salary",
  questions: "openings.fields.questions",
};

/**
 * The questions as the API takes them, from form values that may hold
 * leftovers of another type: `min` and `max` only for `number`, `options` only
 * for the choice types.
 */
export function cleanQuestions(
  questions: readonly Partial<ApplicationQuestion>[],
): ApplicationQuestion[] {
  return questions.map((question) => {
    const type = question.type ?? "short_text";
    return {
      ...(question.id && { id: question.id }),
      text: question.text ?? "",
      type,
      required: Boolean(question.required),
      ...(type === QuestionNumber &&
        question.min != null && { min: question.min }),
      ...(type === QuestionNumber &&
        question.max != null && { max: question.max }),
      ...(isChoiceQuestion(type) && { options: question.options ?? [] }),
    };
  });
}

/** Whether the edited questions differ from the live ones in any way. */
export function questionsDiffer(
  live: readonly Partial<ApplicationQuestion>[],
  edited: readonly Partial<ApplicationQuestion>[],
): boolean {
  const comparable = (questions: readonly Partial<ApplicationQuestion>[]) =>
    JSON.stringify(
      cleanQuestions(questions).map((question) => ({
        ...question,
        text: question.text.trim(),
        ...(question.options && {
          options: question.options.map((option) => option.trim()),
        }),
      })),
    );
  return comparable(live) !== comparable(edited);
}

/**
 * Field paths, in the `org-opening-incomplete` problem's form, that would
 * refuse a publish or revise request now. Empty when no such request applies
 * or the content is complete. A hint only: orgs-api decides.
 */
export function publicationGaps(opening: OrgOpening): string[] {
  const content =
    opening.state === "draft"
      ? (opening.working_content ?? {})
      : ["published", "paused"].includes(opening.state)
        ? opening.working_content
        : undefined;
  if (content === undefined) return [];
  return [
    ...missingForPublication(content).map((field) => `content.${field}`),
    ...(opening.hiring_manager ? [] : ["hiring_manager_email"]),
    ...(opening.recruiter ? [] : ["recruiter_email"]),
  ];
}

/** Labels a problem field path, collapsing nested paths to their field. */
export function publicationFieldLabels(
  t: TFunction,
  fields: readonly string[],
): string[] {
  const labels = fields.map((field) => {
    if (field === "hiring_manager_email")
      return t("openings.fields.hiringManager");
    if (field === "recruiter_email") return t("openings.editor.recruiter");
    const name = field.replace(/^content\./, "").split(".")[0] ?? field;
    const key = contentLabelKeys[name];
    return key ? t(key) : field;
  });
  return [...new Set(labels)];
}
