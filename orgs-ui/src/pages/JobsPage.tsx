import { FilterOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isCountryCode } from "typespec/common/countries";
import {
  isJobSearchText,
  type Job,
  type ListJobsRequest,
} from "typespec/orgs/marketplace/work/work";
import type { OpeningState } from "typespec/orgs/openings/types";
import { isOrgDomain } from "typespec/orgs/types";
import { paths } from "../app/paths";
import { problemMessage } from "../components/common/APIErrorAlert";
import { countryOptions } from "../features/account/countryOptions";
import { useMyInfoQuery } from "../features/account/queries";
import { ListPager } from "../features/applications/ListPager";
import { useListState } from "../features/applications/listState";
import { JobOwnerModal } from "../features/marketplace/JobOwnerModal";
import {
  openingStateColors,
  openingStateLabel,
} from "../features/marketplace/presentation";
import { useJobsQuery } from "../features/marketplace/queries";
import {
  ClientPicker,
  JobOwnerPicker,
} from "../features/marketplace/SuggestionSelect";

const pageSize = 25;

// Drafts and discarded Openings are never assigned to an agency.
const stateTabs: readonly OpeningState[] = [
  "published",
  "paused",
  "closed",
  "expired",
];

function isListedState(value: unknown): value is OpeningState {
  return stateTabs.includes(value as OpeningState);
}

/**
 * Whose Jobs the list shows: `mine` (the default, what an agent comes for),
 * `all`, or one colleague's address.
 */
type OwnerScope = "mine" | "all" | { email: string };

function ownerScopeOf(value: string | undefined): OwnerScope {
  if (value === undefined || value === "mine") return "mine";
  if (value === "all") return "all";
  return { email: value };
}

/**
 * The Openings clients assigned to the agency, each with the agency user who
 * looks after it. Agents start on their own Jobs; anyone can look across the
 * agency, at one colleague, or at one client.
 */
export function JobsPage() {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const { data: me } = useMyInfoQuery();
  const list = useListState();
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [ownerTarget, setOwnerTarget] = useState<Job>();

  const scope = ownerScopeOf(list.get("owner"));
  // A hand-edited URL never sends a filter the API would refuse.
  const clientParam = list.get("client");
  const client =
    clientParam !== undefined && isOrgDomain(clientParam)
      ? clientParam
      : undefined;
  const searchParam = list.get("q");
  const search =
    searchParam !== undefined && isJobSearchText(searchParam)
      ? searchParam
      : undefined;
  const countryParam = list.get("country");
  const country =
    countryParam !== undefined && isCountryCode(countryParam)
      ? countryParam
      : undefined;
  const stateParam = list.get("state");
  const state: OpeningState = isListedState(stateParam)
    ? stateParam
    : "published";
  const [searchInput, setSearchInput] = useState(search ?? "");

  const ownerEmail =
    scope === "mine"
      ? me?.email_address
      : scope === "all"
        ? undefined
        : scope.email;
  const request: ListJobsRequest = {
    state,
    limit: pageSize,
    ...(ownerEmail !== undefined && { owner_email: ownerEmail }),
    ...(client !== undefined && { client_domain: client }),
    ...(search !== undefined && { search }),
    ...(country !== undefined && { employing_country: country }),
    ...(list.paginationKey !== undefined && {
      pagination_key: list.paginationKey,
    }),
  };
  const jobsQuery = useJobsQuery(request, me !== undefined);
  const jobs = jobsQuery.data?.jobs ?? [];
  const unavailableTenants = jobsQuery.data?.unavailable_tenants ?? [];
  const moreFiltersCount = country === undefined ? 0 : 1;
  const filtered =
    client !== undefined || search !== undefined || country !== undefined;

  const countryNames = new Intl.DisplayNames([i18n.language], {
    type: "region",
  });
  const countryName = (code: string) => {
    try {
      return countryNames.of(code) ?? code;
    } catch {
      return code;
    }
  };

  const columns: ColumnsType<Job> = [
    {
      title: t("marketplace.jobs.tableOpening"),
      key: "opening",
      render: (_, job) => (
        <Flex vertical>
          <Link to={paths.jobDetail(job.engagement_id, job.opening.number)}>
            {job.opening.title}
          </Link>
          <Typography.Text type="secondary">
            {[
              `#${job.opening.number}`,
              ...(job.opening.employing_country
                ? [countryName(job.opening.employing_country)]
                : []),
            ].join(" · ")}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("marketplace.jobs.tableClient"),
      key: "client",
      render: (_, job) => (
        <Flex vertical>
          <Typography.Text>{job.client.display_name}</Typography.Text>
          <Typography.Text type="secondary">
            {job.client.domain}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("marketplace.jobs.tableOwner"),
      key: "owner",
      render: (_, job) => (
        <Flex align="center" gap="small" wrap>
          {job.owner === undefined ? (
            <Typography.Text type="secondary">
              {t("marketplace.jobs.owner.none")}
            </Typography.Text>
          ) : (
            <Typography.Text>
              {job.owner === me?.email_address
                ? t("marketplace.jobs.owner.you", { owner: job.owner })
                : job.owner}
            </Typography.Text>
          )}
          <Button
            type="link"
            size="small"
            aria-label={t("marketplace.jobs.owner.changeFor", {
              title: job.opening.title,
            })}
            onClick={() => setOwnerTarget(job)}
          >
            {t("marketplace.jobs.owner.change")}
          </Button>
        </Flex>
      ),
    },
    ...(state === "published"
      ? []
      : [
          {
            title: t("marketplace.jobs.tableState"),
            key: "state",
            render: (_: unknown, job: Job) => (
              <Tag color={openingStateColors[job.state] ?? "default"}>
                {openingStateLabel(t, job.state)}
              </Tag>
            ),
          },
        ]),
    {
      title: t("marketplace.jobs.tableAssigned"),
      key: "assigned",
      render: (_, job) => date(job.assigned_at),
    },
    {
      title: (
        <Flex gap={4} justify="end">
          {t("marketplace.jobs.tableCredited")}
          <Tooltip title={t("marketplace.jobs.creditedHelp")}>
            <QuestionCircleOutlined
              aria-label={t("marketplace.jobs.creditedHelp")}
            />
          </Tooltip>
        </Flex>
      ),
      key: "credited",
      align: "end",
      render: (_, job) => job.credited_count,
    },
  ];

  const clearFilters = () => {
    setSearchInput("");
    list.set({ client: undefined, q: undefined, country: undefined });
  };

  const emptyState =
    scope === "mine" && !filtered ? (
      <Empty description={t("marketplace.jobs.emptyMine")}>
        <Button type="primary" onClick={() => list.set({ owner: "all" })}>
          {t("marketplace.jobs.showAll")}
        </Button>
      </Empty>
    ) : filtered ? (
      <Empty description={t("marketplace.jobs.emptyFiltered")}>
        <Button onClick={clearFilters}>
          {t("marketplace.jobs.clearFilters")}
        </Button>
      </Empty>
    ) : (
      <Empty description={t("marketplace.jobs.empty")} />
    );

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("marketplace.jobs.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>
          {t("marketplace.jobs.title")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("marketplace.jobs.subtitle")}
        </Typography.Text>
      </div>

      {jobsQuery.isError && (
        <Alert
          type="error"
          showIcon
          title={problemMessage(t, jobsQuery.error)}
          action={
            <Button onClick={() => void jobsQuery.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      )}
      {unavailableTenants.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={t("marketplace.jobs.unavailableNotice", {
            count: unavailableTenants.length,
          })}
        />
      )}

      <Card>
        <Flex vertical gap="middle">
          <Tabs
            activeKey={state}
            onChange={(key) =>
              list.set({ state: key === "published" ? undefined : key })
            }
            items={stateTabs.map((value) => ({
              key: value,
              label: openingStateLabel(t, value),
            }))}
          />
          <Flex gap="small" wrap align="center">
            <Segmented<string>
              aria-label={t("marketplace.jobs.ownerScope")}
              // A colleague's address selects neither option.
              value={typeof scope === "string" ? scope : "colleague"}
              onChange={(value) =>
                list.set({ owner: value === "mine" ? undefined : value })
              }
              options={[
                { value: "mine", label: t("marketplace.jobs.scopeMine") },
                { value: "all", label: t("marketplace.jobs.scopeAll") },
              ]}
            />
            <JobOwnerPicker
              value={typeof scope === "string" ? undefined : scope.email}
              onChange={(email) => list.set({ owner: email ?? "all" })}
              placeholder={t("marketplace.jobs.filterOwner")}
              ariaLabel={t("marketplace.jobs.filterOwner")}
              notFound={t("marketplace.jobs.owner.noneFound")}
            />
            <ClientPicker
              capability="sourcing"
              value={client}
              onChange={(domain) => list.set({ client: domain })}
              placeholder={t("marketplace.jobs.filterClient")}
              ariaLabel={t("marketplace.jobs.filterClient")}
              notFound={t("marketplace.jobs.noClientFound")}
            />
            <Input.Search
              aria-label={t("marketplace.jobs.searchPlaceholder")}
              placeholder={t("marketplace.jobs.searchPlaceholder")}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onSearch={(value) =>
                list.set({ q: value.trim() === "" ? undefined : value.trim() })
              }
              allowClear
              style={{ maxWidth: 260 }}
            />
            <Badge count={moreFiltersCount} size="small">
              <Button
                icon={<FilterOutlined aria-hidden />}
                aria-expanded={showMoreFilters}
                onClick={() => setShowMoreFilters((open) => !open)}
              >
                {t("marketplace.jobs.moreFilters")}
              </Button>
            </Badge>
          </Flex>
          {showMoreFilters ? (
            <Card size="small" type="inner">
              <Form layout="vertical" component="div">
                <Form.Item
                  label={t("marketplace.jobs.filterCountry")}
                  style={{ marginBottom: 0, maxWidth: 320 }}
                >
                  <Select
                    aria-label={t("marketplace.jobs.filterCountry")}
                    value={country}
                    onChange={(value?: string) => list.set({ country: value })}
                    options={countryOptions(i18n.language)}
                    showSearch={{ optionFilterProp: "label" }}
                    allowClear
                  />
                </Form.Item>
              </Form>
            </Card>
          ) : null}

          <Table<Job>
            rowKey={(job) => `${job.engagement_id}-${job.opening.number}`}
            columns={columns}
            dataSource={jobs}
            loading={jobsQuery.isFetching}
            pagination={false}
            locale={{ emptyText: jobsQuery.isLoading ? " " : emptyState }}
            scroll={{ x: "max-content" }}
          />
          <ListPager
            hasPrevious={list.pageIndex > 0}
            hasNext={jobsQuery.data?.next_pagination_key !== undefined}
            busy={jobsQuery.isFetching}
            onPrevious={list.previous}
            onNext={() => {
              const key = jobsQuery.data?.next_pagination_key;
              if (key !== undefined) list.next(key);
            }}
          />
        </Flex>
      </Card>

      {me !== undefined && ownerTarget !== undefined ? (
        <JobOwnerModal
          job={ownerTarget}
          myEmail={me.email_address}
          open
          onClose={() => setOwnerTarget(undefined)}
        />
      ) : null}
    </Space>
  );
}
