import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  List,
  Row,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  DomainFailing,
  DomainReleased,
  type DomainVerificationState,
  DomainVerified,
} from "typespec/orgs/account/account";
import {
  FulfilEngagements,
  holds,
  type OrgPermission,
  type OrgPermissionID,
  orgPermissions,
} from "typespec/orgs/authorization/types";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import { useMyInterviewsQuery } from "../features/applications/queries";
import {
  useContactsQuery,
  useJobsQuery,
} from "../features/marketplace/queries";

const stateColors: Record<DomainVerificationState, string> = {
  [DomainVerified]: "green",
  [DomainFailing]: "orange",
  [DomainReleased]: "red",
};

const previewSize = 5;

// The count reads one page of Jobs; more shows as "50+".
const countedJobs = 50;

function isDefinedPermission(value: OrgPermissionID): value is OrgPermission {
  return (orgPermissions as readonly string[]).includes(value);
}

/**
 * What is the signed-in person's own: the Jobs they own, the interviews they
 * sit on, and the agency's unread conversations they answer. Org-level pages
 * live in the sidebar's workspaces.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { dateTime: formatDateTime } = useDateTimeFormat();
  const { data: me } = useMyInfoQuery();
  const isAgent =
    me?.marketplace.agency === true && holds(me.permissions, FulfilEngagements);
  const myJobs = useJobsQuery(
    { owner_email: me?.email_address ?? "", limit: countedJobs },
    isAgent,
  );
  const unread = useContactsQuery({ filter: "unread", limit: 1 }, isAgent);
  const interviews = useMyInterviewsQuery({ limit: previewSize });
  if (me === undefined) return null;
  const { org } = me;
  const { domain } = org;
  const jobCount = myJobs.data
    ? `${myJobs.data.jobs.length}${myJobs.data.next_pagination_key ? "+" : ""}`
    : undefined;

  return (
    <Flex orientation="vertical" gap="large">
      <title>{t("home.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("home.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("home.description")}
        </Typography.Text>
      </div>

      {isAgent ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card>
              <Statistic
                title={t("home.myJobs")}
                value={jobCount ?? t("common.loading")}
              />
              <Typography.Text type="secondary">
                {t("home.myJobsHelp")}
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card>
              <Statistic
                title={t("home.unreadConversations")}
                value={unread.data?.counts.unread ?? t("common.loading")}
              />
              <Link to={`${paths.contacts}?tab=unread`}>
                {t("home.openInbox")}
              </Link>
            </Card>
          </Col>
        </Row>
      ) : null}

      <Row gutter={[24, 24]}>
        {isAgent ? (
          <Col xs={24} lg={12}>
            <Card
              title={t("home.myJobsCard")}
              extra={<Link to={paths.jobs}>{t("home.seeAll")}</Link>}
              loading={myJobs.isLoading}
            >
              {myJobs.isError ? (
                <Alert type="error" title={t("common.loadError")} />
              ) : (myJobs.data?.jobs.length ?? 0) === 0 ? (
                <Empty description={t("home.noJobs")}>
                  <Link to={`${paths.jobs}?owner=all`}>
                    {t("home.browseJobs")}
                  </Link>
                </Empty>
              ) : (
                <List
                  dataSource={(myJobs.data?.jobs ?? []).slice(0, previewSize)}
                  renderItem={(job) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <Link
                            to={paths.jobDetail(
                              job.engagement_id,
                              job.opening.number,
                            )}
                          >
                            {job.opening.title}
                          </Link>
                        }
                        description={job.client.display_name}
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
        ) : null}
        <Col xs={24} lg={12}>
          <Card
            title={t("home.myInterviewsCard")}
            extra={<Link to={paths.myInterviews}>{t("home.seeAll")}</Link>}
            loading={interviews.isLoading}
          >
            {interviews.isError ? (
              <Alert type="error" title={t("common.loadError")} />
            ) : (interviews.data?.interviews.length ?? 0) === 0 ? (
              <Empty description={t("home.noInterviews")} />
            ) : (
              <List
                dataSource={interviews.data?.interviews ?? []}
                renderItem={(interview) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Link
                          to={paths.application(
                            interview.opening_number,
                            interview.application_number,
                          )}
                        >
                          {interview.display_name}
                        </Link>
                      }
                      description={formatDateTime(interview.starts_at)}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t("home.accountCard")}>
            <Descriptions
              column={1}
              items={[
                {
                  key: "email",
                  label: t("home.signedInAs"),
                  children: me.email_address,
                },
                {
                  key: "organization",
                  label: t("home.organization"),
                  children: (
                    <span data-testid="home-org-name">{org.display_name}</span>
                  ),
                },
                {
                  key: "domain",
                  label: t("fields.domain"),
                  children: (
                    <Flex gap="small" wrap align="center">
                      <Typography.Text strong data-testid="home-domain">
                        {domain.domain}
                      </Typography.Text>
                      <Tag
                        color={stateColors[domain.state]}
                        data-testid="home-domain-state"
                        data-state={domain.state}
                      >
                        {t(`domain.states.${domain.state}`)}
                      </Tag>
                    </Flex>
                  ),
                },
                {
                  key: "verified",
                  label: t("fields.lastVerified"),
                  children: formatDateTime(domain.last_verified_at),
                },
                ...(domain.failing_since === null
                  ? []
                  : [
                      {
                        key: "failing",
                        label: t("fields.failingSince"),
                        children: formatDateTime(domain.failing_since),
                      },
                    ]),
                ...(domain.release_after === null
                  ? []
                  : [
                      {
                        key: "release",
                        label: t("fields.releaseAfter"),
                        children: formatDateTime(domain.release_after),
                      },
                    ]),
                {
                  key: "permissions",
                  label: t("fields.permissions"),
                  children:
                    me.permissions.length === 0 ? (
                      t("home.noPermissions")
                    ) : (
                      <Flex gap="small" wrap data-testid="home-permissions">
                        {me.permissions.map((permission) => (
                          <Tag key={permission}>
                            {isDefinedPermission(permission)
                              ? t(`permissions.${permission}.name`)
                              : permission}
                          </Tag>
                        ))}
                      </Flex>
                    ),
                },
              ]}
            />
            <Link to={paths.security}>{t("home.accountSecurity")}</Link>
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}
