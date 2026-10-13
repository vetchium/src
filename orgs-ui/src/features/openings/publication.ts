import type { TFunction } from "i18next";
import { missingForPublication } from "typespec/common/openings";
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
};

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
