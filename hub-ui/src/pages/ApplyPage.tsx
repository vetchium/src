import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  type AnswerValues,
  answerFits,
  answersFor,
  blankAnswer,
  QuestionFields,
} from "@vetchium/portal-ui/openings";
import { SidePanel } from "@vetchium/portal-ui/shell";
import {
  Alert,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Form,
  Input,
  Progress,
  Radio,
  Row,
  Space,
  Spin,
  Steps,
  Typography,
  theme,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ApplicationQuestion } from "typespec/common/openings";
import type { ApplicationAnswer } from "typespec/orgs/applications/answers";
import {
  isApplicationCoverNote,
  maxCoverNote,
} from "typespec/orgs/applications/applications";
import {
  isOrgDomain,
  normalizeOrgDomain,
  type OrgDomain,
} from "typespec/orgs/types";
import {
  type ApplicationAnswersInvalidDetails,
  ApplicationAnswersInvalidType,
  ApplicationExistsError,
  OpeningNotAcceptingError,
  ReferralAgencyNotEligibleError,
} from "typespec/problem/hub/applications";
import {
  OpeningNotFoundError,
  OrgNotFoundError,
} from "typespec/problem/hub/openings";
import { APIError, isProblem } from "../api/client";
import { hubAPI } from "../api/hub";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { ActionError } from "../features/applications/ActionError";
import { useApplicationAction } from "../features/applications/actions";
import { useMyOpeningApplicationQuery } from "../features/applications/queries";
import { useConversationsQuery } from "../features/messages/queries";
import { questionFieldLabels } from "../features/openings/presentation";
import { useOrgOpeningQuery } from "../features/openings/queries";
import {
  useMyInfoQuery,
  usePublicProfileQuery,
} from "../features/profile/queries";
import { applicationPath } from "./ApplicationsPage";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "A";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1];
  if (!last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "A";
}

interface ApplyForm {
  cover_note?: string;
  answers?: AnswerValues;
}

const noQuestions: ApplicationQuestion[] = [];

export function ApplyPage() {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const domain = normalizeOrgDomain(params.domain ?? "");
  const number = Number(params.number);
  const valid =
    isOrgDomain(domain) &&
    Number.isInteger(number) &&
    number > 0 &&
    number <= 2_147_483_647;
  const opening = useOrgOpeningQuery(domain, number, valid);
  const me = useMyInfoQuery();
  const profile = usePublicProfileQuery(me.data?.handle ?? "", me.isSuccess);
  const application = useMyOpeningApplicationQuery(domain, number, valid);
  const conversations = useConversationsQuery();

  const referredByParam = searchParams.get("referred_by")?.trim() ?? "";

  const suggestedAgencies = useMemo(() => {
    if (!conversations.data) return [];
    const list: {
      agency_display_name: string;
      agency_domain: OrgDomain;
      sent_at: string;
    }[] = [];
    for (const c of conversations.data.items) {
      const match = c.suggestions.find(
        (s) => s.consumer_domain === domain && s.opening_number === number,
      );
      if (match) {
        list.push({
          agency_display_name: c.agency_display_name,
          agency_domain: c.agency_domain,
          sent_at: match.sent_at,
        });
      }
    }
    return list;
  }, [conversations.data, domain, number]);

  const [form] = Form.useForm<ApplyForm>();
  const answerValues = Form.useWatch("answers", form) as
    | AnswerValues
    | undefined;
  const coverNote = Form.useWatch("cover_note", form) as string | undefined;
  // Set by a submit that failed validation, so unanswered steps show as errors.
  const [attempted, setAttempted] = useState(false);
  const { token } = theme.useToken();
  // Questions the Org's tenant refused; cleared one by one as they are edited.
  const [refused, setRefused] = useState<string[]>([]);
  const [referralChoice, setReferralChoice] = useState<string>("none");
  const [otherDomain, setOtherDomain] = useState<string>("");

  useEffect(() => {
    if (referredByParam) {
      const match = suggestedAgencies.find(
        (a) => a.agency_domain.toLowerCase() === referredByParam.toLowerCase(),
      );
      if (match) {
        setReferralChoice(match.agency_domain);
      } else {
        setReferralChoice("other");
        setOtherDomain(referredByParam);
      }
    }
  }, [referredByParam, suggestedAgencies]);

  const apply = useApplicationAction(
    (
      request: {
        coverNote?: string;
        referralDomain?: OrgDomain;
        answers: ApplicationAnswer[];
      },
      key,
    ) =>
      hubAPI.applyToOpening(
        {
          domain,
          opening_number: number,
          ...(request.coverNote !== undefined && {
            cover_note: request.coverNote,
          }),
          ...(request.answers.length > 0 && { answers: request.answers }),
          ...(request.referralDomain !== undefined && {
            referral_agency_domain: request.referralDomain,
          }),
        },
        key,
      ),
  );
  const existing = application.data ?? undefined;
  const alreadyApplied =
    existing !== undefined ||
    (apply.isError && isProblem(apply.error, ApplicationExistsError.type));
  const notAccepting =
    apply.isError && isProblem(apply.error, OpeningNotAcceptingError.type);
  const referralNotEligible =
    apply.isError &&
    isProblem(apply.error, ReferralAgencyNotEligibleError.type);
  const answersInvalid =
    apply.isError && isProblem(apply.error, ApplicationAnswersInvalidType);
  const openingPath = `/org/${encodeURIComponent(domain)}/openings/${number}`;

  const notFound =
    !valid ||
    (opening.isError &&
      (isProblem(opening.error, OpeningNotFoundError.type) ||
        isProblem(opening.error, OrgNotFoundError.type)));
  if (notFound) {
    return <Typography.Text>{t("orgPage.openingNotFound")}</Typography.Text>;
  }
  if (opening.isPending || me.isPending || profile.isPending) {
    return <Spin aria-label={t("apply.loading")} />;
  }
  if (opening.isError || me.isError || profile.isError) {
    return (
      <Space orientation="vertical">
        <APIErrorAlert error={opening.error ?? me.error ?? profile.error} />
        <Button
          onClick={() => {
            void opening.refetch();
            void me.refetch();
            void profile.refetch();
          }}
        >
          {t("common.retry")}
        </Button>
      </Space>
    );
  }

  const { org } = opening.data;
  const published = opening.data.opening.state === "published";
  const openingTitle =
    opening.data.opening.state === "published"
      ? (opening.data.opening.content.title ?? "")
      : opening.data.opening.title;
  const data = profile.data;
  const questions =
    opening.data.opening.state === "published"
      ? (opening.data.opening.content.questions ?? noQuestions)
      : noQuestions;

  // The Org changed its questions after this page loaded (HP-QST-004): read
  // them again, keep the answers that still fit, and mark the named ones.
  const recoverAnswers = async (error: unknown) => {
    const named =
      error instanceof APIError
        ? ((error.problem as ApplicationAnswersInvalidDetails | undefined)
            ?.question_ids ?? [])
        : [];
    const reloaded = await opening.refetch();
    if (reloaded.isError) return;
    const live =
      reloaded.data?.opening.state === "published"
        ? (reloaded.data.opening.content.questions ?? noQuestions)
        : noQuestions;
    const values = (form.getFieldValue("answers") ?? {}) as AnswerValues;
    const kept: AnswerValues = {};
    for (const question of live) {
      if (question.id === undefined) continue;
      const value = values[question.id];
      if (value !== undefined && answerFits(question, value))
        kept[question.id] = value;
    }
    form.setFieldValue("answers", kept);
    setRefused(
      named.filter((id) => live.some((question) => question.id === id)),
    );
  };

  const acceptsReferrals =
    opening.data.opening.state === "published" &&
    opening.data.opening.accepts_agency_referrals;
  const required = questions.filter(
    (question) => question.required && question.id !== undefined,
  );
  const answeredRequired = required.filter(
    (question) =>
      question.id !== undefined &&
      !blankAnswer(answerValues?.[question.id] ?? undefined),
  ).length;
  const questionsDone = answeredRequired === required.length;
  const sections = [
    {
      id: "apply-profile",
      title: t("apply.steps.profile"),
      status: "finish" as const,
      content: t("apply.steps.profileHelp"),
    },
    ...(questions.length > 0
      ? [
          {
            id: "apply-questions",
            title: t("apply.steps.questions"),
            status:
              questionsDone && refused.length === 0
                ? ("finish" as const)
                : attempted || refused.length > 0
                  ? ("error" as const)
                  : ("process" as const),
            content:
              required.length > 0
                ? t("apply.steps.requiredAnswered", {
                    count: required.length,
                    answered: answeredRequired,
                  })
                : t("apply.steps.allOptional"),
          },
        ]
      : []),
    {
      id: "apply-cover-note",
      title: t("apply.steps.coverNote"),
      status: coverNote?.trim() ? ("finish" as const) : ("wait" as const),
      content: t("apply.steps.optional"),
    },
    ...(acceptsReferrals
      ? [
          {
            id: "apply-referral",
            title: t("apply.referredBy.title"),
            status: "finish" as const,
            content:
              referralChoice === "none"
                ? t("apply.referredBy.noAgency")
                : referralChoice === "other"
                  ? otherDomain.trim() || t("apply.referredBy.anotherAgency")
                  : (suggestedAgencies.find(
                      (agency) => agency.agency_domain === referralChoice,
                    )?.agency_display_name ?? referralChoice),
          },
        ]
      : []),
  ];
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({
      behavior: token.motion ? "smooth" : "auto",
      block: "start",
    });

  const submitPanel = (
    <Card title={openingTitle}>
      <Flex vertical gap="middle">
        <Typography.Text type="secondary">{org.display_name}</Typography.Text>
        {required.length > 0 && (
          <Progress
            percent={Math.floor((answeredRequired / required.length) * 100)}
            status={questionsDone ? "success" : "normal"}
            showInfo={false}
            aria-label={t("apply.steps.requiredAnswered", {
              count: required.length,
              answered: answeredRequired,
            })}
          />
        )}
        <nav aria-label={t("apply.steps.title")}>
          <Steps
            orientation="vertical"
            size="small"
            current={Math.max(
              0,
              sections.findIndex((section) => section.status !== "finish"),
            )}
            onChange={(index) => {
              const section = sections[index];
              if (section) scrollTo(section.id);
            }}
            items={sections.map(({ title, status, content }) => ({
              title,
              status,
              content,
            }))}
          />
        </nav>
        <Button
          type="primary"
          size="large"
          htmlType="submit"
          block
          loading={apply.isPending}
        >
          {t("apply.submit")}
        </Button>
        <Typography.Text type="secondary">{t("apply.once")}</Typography.Text>
        {notAccepting ? (
          <Alert type="warning" showIcon title={t("orgPage.notAccepting")} />
        ) : answersInvalid ? (
          <Alert
            type="warning"
            showIcon
            title={t("apply.questions.changedTitle")}
            description={t("apply.questions.changedHelp")}
          />
        ) : referralNotEligible ? null : (
          <ActionError error={apply.error} />
        )}
      </Flex>
    </Card>
  );

  return (
    <Flex vertical gap="large">
      <NoIndex />
      <title>{t("apply.documentTitle")}</title>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={`/org/${encodeURIComponent(domain)}`}>
                {org.display_name}
              </Link>
            ),
          },
          { title: <Link to={openingPath}>{openingTitle}</Link> },
          { title: t("apply.title") },
        ]}
      />
      <div>
        <Typography.Title level={1}>{t("apply.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("apply.subtitle", { title: openingTitle, org: org.display_name })}
        </Typography.Text>
      </div>
      {!published ? (
        <Alert type="info" showIcon title={t("orgPage.notAccepting")} />
      ) : alreadyApplied ? (
        <Alert
          type="info"
          showIcon
          title={t("apply.alreadyApplied")}
          action={
            existing !== undefined ? (
              <Link to={applicationPath(existing)}>
                {t("apply.viewApplication")}
              </Link>
            ) : (
              <Link to="/applications">{t("apply.viewApplications")}</Link>
            )
          }
        />
      ) : (
        <Form<ApplyForm>
          form={form}
          layout="vertical"
          scrollToFirstError
          onValuesChange={(changed: ApplyForm) => {
            const edited = Object.keys(changed.answers ?? {});
            if (edited.length > 0)
              setRefused((ids) => ids.filter((id) => !edited.includes(id)));
          }}
          onFinishFailed={() => setAttempted(true)}
          onFinish={(values) => {
            const note = values.cover_note?.trim();
            const referral = !acceptsReferrals
              ? undefined
              : referralChoice === "none"
                ? undefined
                : referralChoice === "other"
                  ? otherDomain.trim() || undefined
                  : referralChoice;
            apply.mutate(
              {
                coverNote: note === undefined || note === "" ? undefined : note,
                referralDomain: referral as OrgDomain | undefined,
                answers: answersFor(questions, values.answers ?? {}),
              },
              {
                onError: (error) => {
                  if (isProblem(error, ApplicationAnswersInvalidType))
                    void recoverAnswers(error);
                },
                onSuccess: (reference) => {
                  if ("application_number" in reference) {
                    void navigate(
                      applicationPath({
                        org_domain: reference.domain,
                        opening_number: reference.opening_number,
                        application_number: reference.application_number,
                      }),
                    );
                  }
                },
              },
            );
          }}
        >
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={16}>
              <Flex vertical gap="middle">
                <Card
                  id="apply-profile"
                  size="small"
                  title={t("apply.willSee", { org: org.display_name })}
                  extra={
                    <Link to="/settings/profile">{t("apply.editProfile")}</Link>
                  }
                >
                  <Flex vertical gap="small">
                    <Typography.Text strong>
                      {data.display_name}
                    </Typography.Text>
                    <Descriptions
                      size="small"
                      column={{ xs: 1, sm: 2, md: 3 }}
                      items={[
                        {
                          key: "biography",
                          label: t("apply.summary.biography"),
                          children: t(
                            data.biography
                              ? "apply.summary.included"
                              : "apply.summary.none",
                          ),
                        },
                        {
                          key: "work",
                          label: t("apply.summary.work"),
                          children: t("apply.summary.roles", {
                            count: data.work_experiences.length,
                          }),
                        },
                        {
                          key: "education",
                          label: t("apply.summary.education"),
                          children: t("apply.summary.entries", {
                            count: data.educational_qualifications.length,
                          }),
                        },
                        {
                          key: "certifications",
                          label: t("apply.summary.certifications"),
                          children: t("apply.summary.entries", {
                            count: data.certifications.length,
                          }),
                        },
                        {
                          key: "languages",
                          label: t("apply.summary.languages"),
                          children: t("apply.summary.entries", {
                            count: data.language_abilities.length,
                          }),
                        },
                        {
                          key: "websites",
                          label: t("apply.summary.websites"),
                          children: t("apply.summary.links", {
                            count: data.websites.length,
                          }),
                        },
                      ]}
                    />
                    <Typography.Text type="secondary">
                      {t("apply.snapshotNote")}
                    </Typography.Text>
                  </Flex>
                </Card>
                {questions.length > 0 && (
                  <Card
                    id="apply-questions"
                    size="small"
                    title={t("apply.questions.title", {
                      org: org.display_name,
                    })}
                  >
                    <QuestionFields
                      questions={questions}
                      invalid={refused}
                      labels={questionFieldLabels(
                        t,
                        i18n.language,
                        org.display_name,
                      )}
                    />
                  </Card>
                )}
                <Card
                  id="apply-cover-note"
                  size="small"
                  title={t("apply.coverNote.title")}
                >
                  <Form.Item
                    name="cover_note"
                    label={t("apply.coverNote.label")}
                    rules={[
                      {
                        validator: async (_, value: string | undefined) => {
                          const trimmed = (value ?? "").trim();
                          if (
                            trimmed !== "" &&
                            !isApplicationCoverNote(trimmed)
                          ) {
                            throw new Error(t("apply.coverNote.invalid"));
                          }
                        },
                      },
                    ]}
                  >
                    <Input.TextArea
                      autoSize={{ minRows: 4, maxRows: 12 }}
                      maxLength={maxCoverNote}
                      showCount
                      placeholder={t("apply.coverNote.placeholder")}
                    />
                  </Form.Item>
                </Card>
                {acceptsReferrals && (
                  <Card
                    id="apply-referral"
                    size="small"
                    title={t("apply.referredBy.title")}
                  >
                    <Flex vertical gap="middle">
                      <Typography.Text type="secondary">
                        {t("apply.referredBy.description")}
                      </Typography.Text>
                      <Radio.Group
                        value={referralChoice}
                        onChange={(e) => setReferralChoice(e.target.value)}
                      >
                        <Flex vertical gap="small">
                          <Radio value="none">
                            {t("apply.referredBy.noAgency")}
                          </Radio>
                          {suggestedAgencies.map((agency) => (
                            <Radio
                              key={agency.agency_domain}
                              value={agency.agency_domain}
                            >
                              <Space align="center">
                                <Avatar shape="square" size="small">
                                  {initials(agency.agency_display_name)}
                                </Avatar>
                                <Typography.Text strong>
                                  {agency.agency_display_name}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  ·{" "}
                                  {t("apply.referredBy.suggestedOn", {
                                    date: date(agency.sent_at, "medium"),
                                  })}
                                </Typography.Text>
                              </Space>
                            </Radio>
                          ))}
                          <Radio value="other">
                            {t("apply.referredBy.anotherAgency")}
                          </Radio>
                        </Flex>
                      </Radio.Group>
                      {referralChoice === "other" && (
                        <Form.Item
                          label={t("apply.referredBy.agencyDomain")}
                          {...(referralNotEligible && {
                            validateStatus: "error" as const,
                            help: t("apply.referredBy.notEligible", {
                              domain: otherDomain.trim() || referralChoice,
                            }),
                          })}
                        >
                          <Input
                            placeholder="agency.example"
                            value={otherDomain}
                            onChange={(e) => setOtherDomain(e.target.value)}
                          />
                        </Form.Item>
                      )}
                    </Flex>
                  </Card>
                )}
              </Flex>
            </Col>
            <Col xs={24} lg={8}>
              <SidePanel>{submitPanel}</SidePanel>
            </Col>
          </Row>
        </Form>
      )}
    </Flex>
  );
}
