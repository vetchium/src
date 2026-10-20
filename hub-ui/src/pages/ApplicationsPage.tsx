import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { regionFromSearchParams } from "@vetchium/portal-ui/region-selection";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  List,
  Space,
  Spin,
  Tabs,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { MyApplicationSummary } from "typespec/hub/applications/applications";
import { regionTable } from "../app/regions";
import { readSession } from "../auth/session";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { isClosed } from "../features/applications/presentation";
import { useMyApplicationsQuery } from "../features/applications/queries";
import { StatusTag } from "../features/applications/StatusTag";

export function applicationPath(application: {
  org_domain: string;
  opening_number: number;
  application_number: number;
}): string {
  return `/applications/${encodeURIComponent(application.org_domain)}/${application.opening_number}/${application.application_number}`;
}

function ApplicationRow({
  application,
}: {
  application: MyApplicationSummary;
}) {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  return (
    <List.Item
      extra={
        <Space orientation="vertical" align="end" size={4}>
          <StatusTag status={application.status} />
          {application.pending_actions.map((kind) => (
            <Badge
              key={kind}
              status="warning"
              text={
                <Typography.Text strong>
                  {t(`applications.pending.${kind}`, kind)}
                </Typography.Text>
              }
            />
          ))}
        </Space>
      }
    >
      <List.Item.Meta
        title={
          <Link to={applicationPath(application)}>
            {application.opening_title}
          </Link>
        }
        description={
          <Space orientation="vertical" size={0}>
            <Typography.Text type="secondary">
              {application.org_display_name}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t("applications.list.dates", {
                applied: date(application.applied_at),
                updated: date(application.last_activity_at),
              })}
            </Typography.Text>
          </Space>
        }
      />
    </List.Item>
  );
}

export function ApplicationsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const applications = useMyApplicationsQuery();
  const tab = search.get("tab") === "closed" ? "closed" : "active";
  // An emailed link names the region of the account it is for. Requests go to
  // the signed-in session's region only, so a link for another account is
  // explained instead of silently showing this one's applications.
  const linkRegion = regionFromSearchParams(regionTable, search);
  const otherRegion =
    linkRegion !== null && linkRegion !== readSession()?.tenantId;
  const active = applications.data?.filter((a) => !isClosed(a)) ?? [];
  const closed = applications.data?.filter(isClosed) ?? [];
  const shown = tab === "closed" ? closed : active;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("applications.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("applications.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("applications.subtitle")}
        </Typography.Text>
      </div>
      {otherRegion ? (
        <Alert type="warning" showIcon title={t("applications.otherRegion")} />
      ) : null}
      {applications.isPending ? (
        <Spin aria-label={t("applications.loading")} />
      ) : applications.isError ? (
        <Space orientation="vertical">
          <APIErrorAlert error={applications.error} />
          <Button onClick={() => void applications.refetch()}>
            {t("common.retry")}
          </Button>
        </Space>
      ) : (
        <Tabs
          activeKey={tab}
          onChange={(key) =>
            setSearch(
              (current) => {
                const next = new URLSearchParams(current);
                if (key === "closed") next.set("tab", "closed");
                else next.delete("tab");
                return next;
              },
              { replace: true },
            )
          }
          items={[
            {
              key: "active",
              label: t("applications.tabs.active", { count: active.length }),
            },
            {
              key: "closed",
              label: t("applications.tabs.closed", { count: closed.length }),
            },
          ]}
        />
      )}
      {applications.isSuccess ? (
        shown.length === 0 ? (
          <Empty
            description={t(
              tab === "closed"
                ? "applications.list.emptyClosed"
                : "applications.list.emptyActive",
            )}
          />
        ) : (
          <Card>
            <List
              dataSource={shown}
              rowKey={(a) =>
                `${a.org_domain}/${a.opening_number}/${a.application_number}`
              }
              renderItem={(application) => (
                <ApplicationRow application={application} />
              )}
            />
          </Card>
        )
      ) : null}
    </Space>
  );
}
