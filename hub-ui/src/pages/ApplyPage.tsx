import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Row,
  Space,
  Spin,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import {
  isApplicationCoverNote,
  maxCoverNote,
} from "typespec/orgs/applications/applications";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import {
  ApplicationExistsError,
  OpeningNotAcceptingError,
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
import { useOrgOpeningQuery } from "../features/openings/queries";
import {
  useMyInfoQuery,
  usePublicProfileQuery,
} from "../features/profile/queries";
import { applicationPath } from "./ApplicationsPage";

interface ApplyForm {
  cover_note?: string;
}

export function ApplyPage() {
  const { t } = useTranslation();
  const params = useParams();
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
  const apply = useApplicationAction((coverNote: string | undefined, key) =>
    hubAPI.applyToOpening(
      {
        domain,
        opening_number: number,
        ...(coverNote !== undefined && { cover_note: coverNote }),
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
            apply.mutate(note === undefined || note === "" ? undefined : note, {
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
            });
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
                  ) : (
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
