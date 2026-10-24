import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Radio,
  Row,
  Space,
  Spin,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
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
  ApplicationExistsError,
  OpeningNotAcceptingError,
  ReferralAgencyNotEligibleError,
} from "typespec/problem/hub/applications";
import {
  OpeningNotFoundError,
  OrgNotFoundError,
} from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { hubAPI } from "../api/hub";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { ActionError } from "../features/applications/ActionError";
import { useApplicationAction } from "../features/applications/actions";
import { useMyApplicationsQuery } from "../features/applications/queries";
import { useConversationsQuery } from "../features/messages/queries";
import { useOrgOpeningQuery } from "../features/openings/queries";
import {
  useMyInfoQuery,
  usePublicProfileQuery,
} from "../features/profile/queries";
import { applicationPath } from "./ApplicationsPage";

const avatarColors = [
  "#1677ff",
  "#722ed1",
  "#13c2c2",
  "#52c41a",
  "#eb2f96",
  "#fa8c16",
  "#faad14",
  "#2f54eb",
];

function avatarColor(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return avatarColors[Math.abs(hash) % avatarColors.length] ?? "#1677ff";
}

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
}

export function ApplyPage() {
  const { t } = useTranslation();
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
  const applications = useMyApplicationsQuery();
  const conversations = useConversationsQuery();

  const referredByParam = searchParams.get("referred_by")?.trim() ?? "";

  const suggestedAgencies = useMemo(() => {
    if (!conversations.data) return [];
    const list: {
      agency_display_name: string;
      agency_domain: OrgDomain;
      agency_logo_url?: string;
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
          agency_logo_url: c.agency_logo_url,
          sent_at: match.sent_at,
        });
      }
    }
    return list;
  }, [conversations.data, domain, number]);

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
    (request: { coverNote?: string; referralDomain?: OrgDomain }, key) =>
      hubAPI.applyToOpening(
        {
          domain,
          opening_number: number,
          ...(request.coverNote !== undefined && {
            cover_note: request.coverNote,
          }),
          ...(request.referralDomain !== undefined && {
            referral_agency_domain: request.referralDomain,
          }),
        },
        key,
      ),
  );
  const existing = applications.data?.find(
    (a) => a.org_domain === domain && a.opening_number === number,
  );
  const alreadyApplied =
    existing !== undefined ||
    (apply.isError && isProblem(apply.error, ApplicationExistsError.type));
  const notAccepting =
    apply.isError && isProblem(apply.error, OpeningNotAcceptingError.type);
  const referralNotEligible =
    apply.isError &&
    isProblem(apply.error, ReferralAgencyNotEligibleError.type);
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

  return (
    <Space orientation="vertical" size="large" className="full-width">
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
          layout="vertical"
          onFinish={(values) => {
            const note = values.cover_note?.trim();
            const referral =
              referralChoice === "none"
                ? undefined
                : referralChoice === "other"
                  ? otherDomain.trim() || undefined
                  : referralChoice;
            apply.mutate(
              {
                coverNote: note === undefined || note === "" ? undefined : note,
                referralDomain: referral as OrgDomain | undefined,
              },
              {
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
              <Space orientation="vertical" size="large" className="full-width">
                <Card title={t("apply.willSee", { org: org.display_name })}>
                  <Space orientation="vertical" className="full-width">
                    <Typography.Title level={4}>
                      {data.display_name}
                    </Typography.Title>
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label={t("apply.summary.biography")}>
                        {t(
                          data.biography
                            ? "apply.summary.included"
                            : "apply.summary.none",
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("apply.summary.work")}>
                        {t("apply.summary.roles", {
                          count: data.work_experiences.length,
                        })}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("apply.summary.education")}>
                        {t("apply.summary.entries", {
                          count: data.educational_qualifications.length,
                        })}
                      </Descriptions.Item>
                      <Descriptions.Item
                        label={t("apply.summary.certifications")}
                      >
                        {t("apply.summary.entries", {
                          count: data.certifications.length,
                        })}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("apply.summary.languages")}>
                        {t("apply.summary.entries", {
                          count: data.language_abilities.length,
                        })}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("apply.summary.websites")}>
                        {t("apply.summary.links", {
                          count: data.websites.length,
                        })}
                      </Descriptions.Item>
                    </Descriptions>
                    <Typography.Text type="secondary">
                      {t("apply.snapshotNote")}
                    </Typography.Text>
                    <Link to="/settings/profile">{t("apply.editProfile")}</Link>
                  </Space>
                </Card>
                <Card title={t("apply.coverNote.title")}>
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
                      rows={6}
                      maxLength={maxCoverNote}
                      showCount
                      placeholder={t("apply.coverNote.placeholder")}
                    />
                  </Form.Item>
                </Card>
                <Card title={t("apply.referredBy.title")}>
                  <Space
                    orientation="vertical"
                    size="middle"
                    className="full-width"
                  >
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: 0 }}
                    >
                      {t("apply.referredBy.description")}
                    </Typography.Paragraph>
                    <Radio.Group
                      value={referralChoice}
                      onChange={(e) => setReferralChoice(e.target.value)}
                    >
                      <Space orientation="vertical" size="middle">
                        <Radio value="none">
                          {t("apply.referredBy.noAgency")}
                        </Radio>
                        {suggestedAgencies.map((agency) => (
                          <Radio
                            key={agency.agency_domain}
                            value={agency.agency_domain}
                          >
                            <Space align="center">
                              {agency.agency_logo_url ? (
                                <Avatar
                                  shape="square"
                                  size={24}
                                  src={agency.agency_logo_url}
                                />
                              ) : (
                                <Avatar
                                  shape="square"
                                  size={24}
                                  style={{
                                    backgroundColor: avatarColor(
                                      agency.agency_display_name,
                                    ),
                                    fontSize: 11,
                                    fontWeight: "bold",
                                  }}
                                >
                                  {initials(agency.agency_display_name)}
                                </Avatar>
                              )}
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
                      </Space>
                    </Radio.Group>
                    {referralChoice === "other" && (
                      <div style={{ marginLeft: 24, maxWidth: 360 }}>
                        <Typography.Text
                          style={{ display: "block", marginBottom: 4 }}
                        >
                          {t("apply.referredBy.agencyDomain")}
                        </Typography.Text>
                        <Input
                          placeholder="agency.example"
                          value={otherDomain}
                          status={referralNotEligible ? "error" : undefined}
                          onChange={(e) => setOtherDomain(e.target.value)}
                        />
                        {referralNotEligible && (
                          <Typography.Text
                            type="danger"
                            style={{
                              display: "block",
                              marginTop: 4,
                              fontSize: 13,
                            }}
                          >
                            {t("apply.referredBy.notEligible", {
                              domain: otherDomain.trim() || referralChoice,
                            })}
                          </Typography.Text>
                        )}
                      </div>
                    )}
                  </Space>
                </Card>
              </Space>
            </Col>
            <Col xs={24} lg={8}>
              <Card>
                <Space orientation="vertical" className="full-width">
                  <Typography.Text strong>{openingTitle}</Typography.Text>
                  <Typography.Text type="secondary">
                    {org.display_name}
                  </Typography.Text>
                  <Button
                    type="primary"
                    htmlType="submit"
                    block
                    loading={apply.isPending}
                  >
                    {t("apply.submit")}
                  </Button>
                  <Typography.Text type="secondary">
                    {t("apply.once")}
                  </Typography.Text>
                  {notAccepting ? (
                    <Alert
                      type="warning"
                      showIcon
                      title={t("orgPage.notAccepting")}
                    />
                  ) : referralNotEligible ? null : (
                    <ActionError error={apply.error} />
                  )}
                </Space>
              </Card>
            </Col>
          </Row>
        </Form>
      )}
    </Space>
  );
}
