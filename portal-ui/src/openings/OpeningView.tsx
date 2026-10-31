import {
  ClockCircleOutlined,
  EnvironmentOutlined,
  LaptopOutlined,
  TrophyOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Card,
  Col,
  Descriptions,
  type DescriptionsProps,
  Divider,
  Flex,
  Row,
  Tag,
  Typography,
} from "antd";
import type { ReactNode } from "react";
import type {
  ApplicationQuestion,
  OpeningContent,
} from "typespec/common/openings";
import { SidePanel } from "../shell.tsx";
import { OpeningDescription } from "./OpeningDescription.tsx";

export type OpeningContentLabels = Record<
  | "description"
  | "details"
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

export interface OpeningQuestionsPresentation {
  heading: string;
  /** One line under the heading, such as "6 questions, 4 required". */
  summary: (total: number, required: number) => string;
  /** One line under the question: its type, whether required, and bounds. */
  describe: (question: ApplicationQuestion) => string;
}

export interface OpeningPresentation {
  labels: OpeningContentLabels;
  formatters: OpeningContentFormatters;
  questions: OpeningQuestionsPresentation;
}

export interface OpeningViewOrg {
  name: ReactNode;
  /** Secondary text after the name, such as the domain and country. */
  detail?: string;
  logoURL?: string;
}

export interface OpeningViewProps {
  content: OpeningContent;
  presentation: OpeningPresentation;
  org?: OpeningViewOrg;
  /** 1 when the Opening is the page; smaller when it is one of several. */
  titleLevel?: 1 | 2 | 3 | 4;
  /** Shown beside the Opening from `lg`, and below it on narrower screens. */
  aside?: ReactNode;
}

/**
 * The Opening as candidates see it. The Hub Opening page and every Orgs
 * preview render this one component, so a preview cannot drift from the Hub
 * (OPN-ORG-004).
 */
export function OpeningView({
  content,
  presentation,
  org,
  titleLevel = 1,
  aside,
}: OpeningViewProps) {
  const { labels, formatters } = presentation;

  const facts: { key: string; icon: ReactNode; text: string }[] = [];
  if (content.employing_country)
    facts.push({
      key: "country",
      icon: <EnvironmentOutlined aria-hidden />,
      text: formatters.country(content.employing_country),
    });
  if (content.work_arrangement)
    facts.push({
      key: "arrangement",
      icon: <LaptopOutlined aria-hidden />,
      text: formatters.workArrangement(content.work_arrangement),
    });
  if (content.employment_type)
    facts.push({
      key: "employment",
      icon: <ClockCircleOutlined aria-hidden />,
      text: formatters.employmentType(content.employment_type),
    });
  const experience = content.experience_years;
  if (
    experience &&
    (experience.min !== undefined || experience.max !== undefined)
  )
    facts.push({
      key: "experience",
      icon: <TrophyOutlined aria-hidden />,
      text: formatters.experienceYears(experience.min, experience.max),
    });
  const salary = content.salary;
  const salaryText =
    salary?.currency &&
    salary.min !== undefined &&
    salary.max !== undefined &&
    salary.period
      ? formatters.salary(
          salary.currency,
          salary.min,
          salary.max,
          salary.period,
        )
      : undefined;

  const details: NonNullable<DescriptionsProps["items"]> = [];
  if (content.location_details)
    details.push({
      key: "location",
      label: labels.locationDetails,
      children: content.location_details,
    });
  if (content.remote_eligibility)
    details.push({
      key: "remote",
      label: labels.remoteEligibility,
      children: formatters.remoteEligibility(
        content.remote_eligibility.kind,
        content.remote_eligibility.countries ?? [],
      ),
    });
  if (content.positions !== undefined)
    details.push({
      key: "positions",
      label: labels.positions,
      children: content.positions,
    });
  if (content.minimum_education)
    details.push({
      key: "education",
      label: labels.minimumEducation,
      children: formatters.minimumEducation(content.minimum_education),
    });
  if (content.language)
    details.push({
      key: "language",
      label: labels.language,
      children: formatters.language(content.language),
    });

  const questions = content.questions ?? [];
  const opening = (
    <Card>
      <Flex vertical gap="middle">
        {org && (
          <Flex gap="small" align="center">
            {org.logoURL && (
              <Avatar shape="square" size={40} src={org.logoURL} alt="" />
            )}
            <Flex vertical>
              <Typography.Text strong>{org.name}</Typography.Text>
              {org.detail && (
                <Typography.Text type="secondary">{org.detail}</Typography.Text>
              )}
            </Flex>
          </Flex>
        )}
        {content.title && (
          <Typography.Title level={titleLevel}>
            {content.title}
          </Typography.Title>
        )}
        {(facts.length > 0 || salaryText) && (
          <Flex gap="small" wrap>
            {facts.map((fact) => (
              <Tag key={fact.key} icon={fact.icon} variant="filled">
                {fact.text}
              </Tag>
            ))}
            {salaryText && (
              <Tag
                icon={<WalletOutlined aria-hidden />}
                variant="filled"
                color="success"
                aria-label={`${labels.salary}: ${salaryText}`}
              >
                {salaryText}
              </Tag>
            )}
          </Flex>
        )}
        {content.description && (
          <section aria-label={labels.description}>
            <Divider />
            <Typography>
              <OpeningDescription source={content.description} />
            </Typography>
          </section>
        )}
        {details.length > 0 && (
          <Descriptions
            title={labels.details}
            size="small"
            column={{ xs: 1, sm: 2 }}
            items={details}
          />
        )}
        {questions.length > 0 && (
          <section aria-label={presentation.questions.heading}>
            <Typography.Title level={5}>
              {presentation.questions.heading}
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              {presentation.questions.summary(
                questions.length,
                questions.filter((question) => question.required).length,
              )}
            </Typography.Paragraph>
            <Flex vertical gap="small">
              {questions.map((question, index) => (
                <Flex key={question.id ?? index} vertical>
                  <Typography.Text>
                    {index + 1}. {question.text}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {presentation.questions.describe(question)}
                  </Typography.Text>
                </Flex>
              ))}
            </Flex>
          </section>
        )}
      </Flex>
    </Card>
  );
  if (aside === undefined) return opening;
  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={16}>
        {opening}
      </Col>
      <Col xs={24} lg={8}>
        <SidePanel>{aside}</SidePanel>
      </Col>
    </Row>
  );
}
