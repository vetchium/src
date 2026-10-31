import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { regionFromSearchParams } from "@vetchium/portal-ui/region-selection";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Flex,
  Input,
  List,
  Space,
  Spin,
  Tabs,
  Typography,
} from "antd";
import { useState } from "react";
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
  type MyApplicationFilters,
  useMyApplicationCountsQuery,
  useMyApplicationsQuery,
} from "../features/applications/queries";
import { StatusTag } from "../features/applications/StatusTag";

const queryParam = "q";
const awaitingParam = "awaiting";

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

/** Searches when submitted or cleared; follows the URL on back and forward. */
function ApplicationSearch({
  value,
  onSearch,
}: {
  value: string;
  onSearch: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  return (
    <Input.Search
      className="toolbar-search"
      aria-label={t("applications.filters.search")}
      placeholder={t("applications.filters.search")}
      // UTF-16 length bounds the contract's 200 characters from above.
      maxLength={200}
      value={text}
      allowClear
      onChange={(event) => {
        setText(event.target.value);
        if (event.target.value === "") onSearch("");
      }}
      onSearch={(entered) => onSearch(entered.trim())}
    />
  );
}

function ApplicationList({
  view,
  filters,
  onClearFilters,
}: {
  view: MyApplicationView;
  filters: MyApplicationFilters;
  onClearFilters: () => void;
}) {
  const { t } = useTranslation();
  const applications = useMyApplicationsQuery(view, filters);
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
  if (shown.length === 0 && (filters.query || filters.awaitingAnswer)) {
    return (
      <Empty description={t("applications.list.emptyFiltered")}>
        <Button onClick={onClearFilters}>
          {t("applications.filters.clear")}
        </Button>
      </Empty>
    );
  }
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
  const query = search.get(queryParam) ?? "";
  // Closed applications await nothing, so the filter applies to Active only.
  const awaitingAnswer =
    view === ActiveView && search.get(awaitingParam) === "1";
  const filters: MyApplicationFilters = {
    ...(query !== "" && { query }),
    awaitingAnswer,
  };
  const updateSearch = (change: (next: URLSearchParams) => void) =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        change(next);
        return next;
      },
      { replace: true },
    );
  const clearFilters = () =>
    updateSearch((next) => {
      next.delete(queryParam);
      next.delete(awaitingParam);
    });
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
      <Flex vertical gap="middle">
        <Tabs
          activeKey={view}
          onChange={(key) =>
            updateSearch((next) => {
              if (key === ClosedView) {
                next.set("tab", ClosedView);
                next.delete(awaitingParam);
              } else {
                next.delete("tab");
              }
            })
          }
          items={[
            {
              key: ActiveView,
              label: tabLabel(
                t("applications.tabs.active"),
                counts.data?.active,
              ),
            },
            {
              key: ClosedView,
              label: tabLabel(
                t("applications.tabs.closed"),
                counts.data?.closed,
              ),
            },
          ]}
        />
        <Flex gap="middle" wrap align="center">
          <ApplicationSearch
            value={query}
            onSearch={(value) =>
              updateSearch((next) => {
                if (value === "") next.delete(queryParam);
                else next.set(queryParam, value);
              })
            }
          />
          {view === ActiveView ? (
            <Checkbox
              checked={awaitingAnswer}
              onChange={(event) =>
                updateSearch((next) => {
                  if (event.target.checked) next.set(awaitingParam, "1");
                  else next.delete(awaitingParam);
                })
              }
            >
              {tabLabel(
                t("applications.filters.awaitingAnswer"),
                counts.data?.awaiting_answer,
              )}
            </Checkbox>
          ) : null}
          {filters.query !== undefined || awaitingAnswer ? (
            <Button type="link" onClick={clearFilters}>
              {t("applications.filters.clear")}
            </Button>
          ) : null}
        </Flex>
        <ApplicationList
          key={view}
          view={view}
          filters={filters}
          onClearFilters={clearFilters}
        />
      </Flex>
    </Space>
  );
}
