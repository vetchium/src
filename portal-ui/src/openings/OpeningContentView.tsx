import type { ReactNode } from "react";
import type {
  ApplicationQuestion,
  OpeningContent,
} from "typespec/common/openings";
import { OpeningDescription } from "./OpeningDescription.tsx";

export type OpeningContentLabels = Record<
  | "description"
  | "language"
  | "employingCountry"
  | "workArrangement"
  | "locationDetails"
  | "remoteEligibility"
  | "employmentType"
  | "positions"
  | "experienceYears"
  | "minimumEducation"
  | "salary",
  string
>;

export interface OpeningContentFormatters {
  language: (value: string) => string;
  country: (value: string) => string;
  workArrangement: (value: string) => string;
  remoteEligibility: (kind: string, countries: readonly string[]) => string;
  employmentType: (value: string) => string;
  experienceYears: (min?: number, max?: number) => string;
  minimumEducation: (value: string) => string;
  salary: (
    currency: string,
    min: number,
    max: number,
    period: string,
  ) => string;
}

/** Shows `content.questions` when given; without it they stay hidden. */
export interface OpeningQuestionsPresentation {
  heading: string;
  /** One line under the question: its type, whether required, and bounds. */
  describe: (question: ApplicationQuestion) => string;
}

export interface OpeningContentViewProps {
  content: OpeningContent;
  labels: OpeningContentLabels;
  formatters: OpeningContentFormatters;
  questions?: OpeningQuestionsPresentation;
}

export function OpeningContentView({
  content,
  labels,
  formatters,
  questions,
}: OpeningContentViewProps) {
  const fields: { label: string; value: ReactNode }[] = [];
  if (content.language)
    fields.push({
      label: labels.language,
      value: formatters.language(content.language),
    });
  if (content.employing_country)
    fields.push({
      label: labels.employingCountry,
      value: formatters.country(content.employing_country),
    });
  if (content.work_arrangement)
    fields.push({
      label: labels.workArrangement,
      value: formatters.workArrangement(content.work_arrangement),
    });
  if (content.location_details)
    fields.push({
      label: labels.locationDetails,
      value: content.location_details,
    });
  if (content.remote_eligibility)
    fields.push({
      label: labels.remoteEligibility,
      value: formatters.remoteEligibility(
        content.remote_eligibility.kind,
        content.remote_eligibility.countries ?? [],
      ),
    });
  if (content.employment_type)
    fields.push({
      label: labels.employmentType,
      value: formatters.employmentType(content.employment_type),
    });
  if (content.positions !== undefined)
    fields.push({ label: labels.positions, value: content.positions });
  if (
    content.experience_years &&
    (content.experience_years.min !== undefined ||
      content.experience_years.max !== undefined)
  )
    fields.push({
      label: labels.experienceYears,
      value: formatters.experienceYears(
        content.experience_years.min,
        content.experience_years.max,
      ),
    });
  if (content.minimum_education)
    fields.push({
      label: labels.minimumEducation,
      value: formatters.minimumEducation(content.minimum_education),
    });
  if (
    content.salary?.currency &&
    content.salary.min !== undefined &&
    content.salary.max !== undefined &&
    content.salary.period
  )
    fields.push({
      label: labels.salary,
      value: formatters.salary(
        content.salary.currency,
        content.salary.min,
        content.salary.max,
        content.salary.period,
      ),
    });

  return (
    <article>
      {content.title && <h2>{content.title}</h2>}
      {content.description && (
        <section aria-label={labels.description}>
          <OpeningDescription source={content.description} />
        </section>
      )}
      <dl>
        {fields.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {questions && content.questions && content.questions.length > 0 && (
        <section aria-label={questions.heading}>
          <h3>{questions.heading}</h3>
          <ol>
            {content.questions.map((question, index) => (
              <li key={question.id ?? index}>
                <div>{question.text}</div>
                <small>{questions.describe(question)}</small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
