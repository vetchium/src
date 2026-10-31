import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { regionFromSearchParams } from "@vetchium/portal-ui/region-selection";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  List,
  Space,
  Spin,
  Tabs,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
  ActiveView,
  ClosedView,
  type MyApplicationSummary,
  type MyApplicationView,
} from "typespec/hub/applications/applications";
import { regionTable } from "../app/regions";
import { readSession } from "../auth/session";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import {
  useMyApplicationCountsQuery,
  useMyApplicationsQuery,
} from "../features/applications/queries";
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

function ApplicationList({ view }: { view: MyApplicationView }) {
  const { t } = useTranslation();
  const applications = useMyApplicationsQuery(view);
  if (applications.isPending) {
    return <Spin aria-label={t("applications.loading")} />;
  }
  // A failed "Show more" keeps the loaded pages; only a failed first page
  // replaces the list.
  if (applications.data === undefined) {
    return (
      <Space orientation="vertical">
        <APIErrorAlert error={applications.error} />
        <Button onClick={() => void applications.refetch()}>
          {t("common.retry")}
        </Button>
      </Space>
    );
  }
  const shown = applications.data.pages.flatMap((page) => page.applications);
  if (shown.length === 0) {
    return (
      <Empty
        description={t(
          view === ClosedView
            ? "applications.list.emptyClosed"
            : "applications.list.emptyActive",
        )}
      />
    );
  }
  return (
    <Card>
      <List
        dataSource={shown}
        rowKey={(a) =>
          `${a.org_domain}/${a.opening_number}/${a.application_number}`
        }
        renderItem={(application) => (
          <ApplicationRow application={application} />
        )}
        loadMore={
          applications.hasNextPage ? (
            <Flex justify="center">
              <Button
                loading={applications.isFetchingNextPage}
                onClick={() => void applications.fetchNextPage()}
              >
                {t("applications.list.more")}
              </Button>
            </Flex>
          ) : null
        }
      />
      {applications.isFetchNextPageError ? (
        <APIErrorAlert error={applications.error} />
      ) : null}
    </Card>
  );
}

export function ApplicationsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const counts = useMyApplicationCountsQuery();
  const view = search.get("tab") === ClosedView ? ClosedView : ActiveView;
  // An emailed link names the region of the account it is for. Requests go to
  // the signed-in session's region only, so a link for another account is
  // explained instead of silently showing this one's applications.
  const linkRegion = regionFromSearchParams(regionTable, search);
  const otherRegion =
    linkRegion !== null && linkRegion !== readSession()?.tenantId;
  const tabLabel = (label: string, count: number | undefined) =>
    count === undefined
      ? label
      : t("applications.tabs.count", { label, count });

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
      <Tabs
        activeKey={view}
        destroyOnHidden
        onChange={(key) =>
          setSearch(
            (current) => {
              const next = new URLSearchParams(current);
              if (key === ClosedView) next.set("tab", ClosedView);
              else next.delete("tab");
              return next;
            },
            { replace: true },
          )
        }
        items={[
          {
            key: ActiveView,
            label: tabLabel(t("applications.tabs.active"), counts.data?.active),
            children: <ApplicationList view={ActiveView} />,
          },
          {
            key: ClosedView,
            label: tabLabel(t("applications.tabs.closed"), counts.data?.closed),
            children: <ApplicationList view={ClosedView} />,
          },
        ]}
      />
    </Space>
  );
}
