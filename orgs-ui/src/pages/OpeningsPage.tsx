import {
  ClockCircleOutlined,
  FilterOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { countryCodeValues } from "typespec/common/countries";
import type { PaginationKey } from "typespec/common/pagination";
import {
  ApproveOpenings,
  holds,
  ManageOpenings,
} from "typespec/orgs/authorization/types";
import type { ListOpeningsRequest } from "typespec/orgs/openings/openings";
import {
  type OpeningState,
  type OrgOpeningSummary,
  openingRequestKinds,
  openingStates,
} from "typespec/orgs/openings/types";
import { APIError } from "../api/client";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import { openingStateColors } from "../features/openings/presentation";
import {
  useOpeningSummaryQuery,
  useOpeningsQuery,
} from "../features/openings/queries";

const pageSize = 25;

// Discarded Openings are listed only when asked for, so their tab comes last.
const stateTabs = [
  ...openingStates.filter((state) => state !== "discarded"),
  "discarded",
] as const;

const advancedFilterKeys = [
  "pending_request_kinds",
  "hiring_manager_email",
  "recruiter_email",
  "employing_country",
  "work_arrangement",
  "employment_type",
] as const satisfies readonly (keyof ListOpeningsRequest)[];

export function OpeningsPage() {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const navigate = useNavigate();
  const { data: me } = useMyInfoQuery();
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<ListOpeningsRequest>({});
  const [titleInput, setTitleInput] = useState("");
  const [managerInput, setManagerInput] = useState("");
  const [recruiterInput, setRecruiterInput] = useState("");
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const summary = useOpeningSummaryQuery();
  const canApprove = me !== undefined && holds(me.permissions, ApproveOpenings);
  const awaiting = useOpeningsQuery(
    { awaiting_my_approval: true, limit: 100 },
    canApprove,
  );
  const query = useOpeningsQuery({
    ...filters,
    limit: pageSize,
    ...(pageKeys[pageIndex] ? { pagination_key: pageKeys[pageIndex] } : {}),
  });

  const applyFilters = (next: ListOpeningsRequest) => {
    setFilters(next);
    setPageKeys([undefined]);
    setPageIndex(0);
  };
  const setFilter = <K extends keyof ListOpeningsRequest>(
    key: K,
    value: ListOpeningsRequest[K],
  ) => {
    applyFilters({ ...filters, [key]: value || undefined });
  };
  const countryNames = new Intl.DisplayNames(undefined, { type: "region" });
  const countryName = (code: string) => {
    try {
      return countryNames.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const countOf = (state: string) =>
    summary.data?.counts.find((entry) => entry.state === state)?.count ?? 0;
  const activeState = filters.states?.[0] ?? "all";
  const advancedCount = advancedFilterKeys.filter(
    (key) => filters[key] !== undefined,
  ).length;
  const anyFilter = Object.values(filters).some((value) => value !== undefined);
  const awaitingCount = awaiting.data
    ? `${awaiting.data.openings.length}${awaiting.data.next_pagination_key ? "+" : ""}`
    : undefined;
  const clearFilters = () => {
    setTitleInput("");
    setManagerInput("");
    setRecruiterInput("");
    applyFilters({});
  };

  const columns: ColumnsType<OrgOpeningSummary> = [
    {
      title: t("openings.columns.opening"),
      key: "opening",
      render: (_, opening) => (
        <Flex vertical>
          <Link to={paths.openingDetail(opening.opening_number)}>
            {opening.title ?? t("openings.untitled")}
          </Link>
          <Typography.Text type="secondary">
            {[
              `#${opening.opening_number}`,
              ...(opening.employing_country
                ? [countryName(opening.employing_country)]
                : []),
            ].join(" · ")}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("openings.fields.state"),
      key: "state",
      render: (_, opening) => (
        <Flex gap="small" wrap>
          <Tag color={openingStateColors[opening.state]}>
            {t(`openings.states.${opening.state}`, {
              defaultValue: opening.state,
            })}
          </Tag>
          {opening.pending_request_kind && (
            <Tag color="gold" icon={<ClockCircleOutlined aria-hidden />}>
              {t("openings.pendingTag", {
                kind: t(
                  `openings.requestKinds.${opening.pending_request_kind}`,
                  {
                    defaultValue: opening.pending_request_kind,
                  },
                ),
              })}
            </Tag>
          )}
        </Flex>
      ),
    },
    {
      title: t("openings.fields.hiringManager"),
      dataIndex: "hiring_manager_email",
      render: (email?: string) =>
        email ? (
          <Typography.Text>{email}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            {t("openings.notSet")}
          </Typography.Text>
        ),
    },
    {
      title: t("openings.fields.updated"),
      dataIndex: "updated_at",
      render: (value: string) => dateTime(value),
    },
  ];

  const advancedFilters = (
    <Card size="small" type="inner">
      <Form layout="vertical" component="div">
        <Row gutter={16}>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label={t("openings.filters.pendingKinds")}>
              <Select
                mode="multiple"
                aria-label={t("openings.filters.pendingKinds")}
                value={filters.pending_request_kinds}
                onChange={(value) =>
                  setFilter(
                    "pending_request_kinds",
                    value.length ? value : undefined,
                  )
                }
                options={openingRequestKinds.map((value) => ({
                  value,
                  label: t(`openings.requestKinds.${value}`),
                }))}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label={t("openings.filters.hiringManager")}>
              <Input.Search
                aria-label={t("openings.filters.hiringManager")}
                value={managerInput}
                onChange={(event) => setManagerInput(event.target.value)}
                onSearch={(value) =>
                  setFilter("hiring_manager_email", value.trim() || undefined)
                }
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label={t("openings.filters.recruiter")}>
              <Input.Search
                aria-label={t("openings.filters.recruiter")}
                value={recruiterInput}
                onChange={(event) => setRecruiterInput(event.target.value)}
                onSearch={(value) =>
                  setFilter("recruiter_email", value.trim() || undefined)
                }
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label={t("openings.fields.country")}>
              <Select
                showSearch
                aria-label={t("openings.fields.country")}
                value={filters.employing_country}
                onChange={(value) => setFilter("employing_country", value)}
                options={countryCodeValues.map((value) => ({
                  value,
                  label: countryName(value),
                }))}
                optionFilterProp="label"
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label={t("openings.fields.workArrangement")}>
              <Select
                aria-label={t("openings.fields.workArrangement")}
                value={filters.work_arrangement}
                onChange={(value) => setFilter("work_arrangement", value)}
                options={["on_site", "hybrid", "remote"].map((value) => ({
                  value,
                  label: t(`openings.workArrangements.${value}`),
                }))}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label={t("openings.fields.employmentType")}>
              <Select
                aria-label={t("openings.fields.employmentType")}
                value={filters.employment_type}
                onChange={(value) => setFilter("employment_type", value)}
                options={[
                  "full_time",
                  "part_time",
                  "contract",
                  "internship",
                ].map((value) => ({
                  value,
                  label: t(`openings.employmentTypes.${value}`),
                }))}
                allowClear
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Card>
  );

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("openings.documentTitle")}</title>
      <Flex align="center" justify="space-between" wrap gap="middle">
        <div>
          <Typography.Title level={1}>{t("openings.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("openings.intro")}
          </Typography.Text>
        </div>
        {me && holds(me.permissions, ManageOpenings) && (
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => navigate(paths.newOpening)}
          >
            {t("openings.new")}
          </Button>
        )}
      </Flex>
      {summary.isError &&
        !(
          summary.error instanceof APIError && summary.error.status === 404
        ) && (
          <Alert
            type="error"
            title={t("common.loadError")}
            action={
              <Button onClick={() => void summary.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        )}
      {summary.data && (
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} md={canApprove ? 8 : 12} style={{ display: "flex" }}>
            <Card className="full-width">
              <Statistic
                title={t("openings.stats.quota")}
                value={summary.data.quota.used}
                suffix={`/ ${summary.data.quota.limit}`}
              />
              <Progress
                percent={Math.min(
                  100,
                  Math.round(
                    (summary.data.quota.used /
                      Math.max(summary.data.quota.limit, 1)) *
                      100,
                  ),
                )}
                status={
                  summary.data.quota.used >= summary.data.quota.limit
                    ? "exception"
                    : "normal"
                }
                showInfo={false}
              />
              <Typography.Text type="secondary">
                {t("openings.quota", {
                  used: summary.data.quota.used,
                  limit: summary.data.quota.limit,
                })}
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} md={canApprove ? 8 : 12} style={{ display: "flex" }}>
            <Card className="full-width">
              <Statistic
                title={t("openings.stats.published")}
                value={countOf("published")}
              />
              <Typography.Text type="secondary">
                {t("openings.stats.publishedHelp")}
              </Typography.Text>
            </Card>
          </Col>
          {canApprove && !awaiting.isError && (
            <Col xs={24} md={8} style={{ display: "flex" }}>
              <Card className="full-width">
                <Statistic
                  title={t("openings.filters.awaitingApproval")}
                  value={awaitingCount ?? t("common.loading")}
                />
                <Button
                  type={filters.awaiting_my_approval ? "default" : "primary"}
                  ghost={!filters.awaiting_my_approval}
                  disabled={
                    !filters.awaiting_my_approval && awaitingCount === "0"
                  }
                  onClick={() =>
                    setFilter(
                      "awaiting_my_approval",
                      filters.awaiting_my_approval ? undefined : true,
                    )
                  }
                >
                  {t(
                    filters.awaiting_my_approval
                      ? "openings.stats.showAll"
                      : "openings.stats.review",
                  )}
                </Button>
              </Card>
            </Col>
          )}
        </Row>
      )}
      <Card>
        <Flex vertical gap="middle">
          <Tabs
            activeKey={activeState}
            onChange={(key) =>
              setFilter(
                "states",
                key === "all" ? undefined : [key as OpeningState],
              )
            }
            items={[
              {
                key: "all",
                label: t("openings.tabs.all"),
              },
              ...stateTabs.map((state) => ({
                key: state,
                label: summary.data
                  ? t("openings.tabs.withCount", {
                      state: t(`openings.states.${state}`),
                      count: countOf(state),
                    })
                  : t(`openings.states.${state}`),
              })),
            ]}
          />
          <Flex gap="small" wrap align="center">
            <Input.Search
              className="toolbar-search"
              aria-label={t("openings.filters.title")}
              placeholder={t("openings.filters.title")}
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              onSearch={(value) =>
                setFilter(
                  "title_query",
                  value.trim().length >= 2 ? value.trim() : undefined,
                )
              }
              allowClear
            />
            <Badge count={advancedCount} size="small">
              <Button
                icon={<FilterOutlined aria-hidden />}
                aria-expanded={showFilters}
                onClick={() => setShowFilters(!showFilters)}
              >
                {t("openings.filters.more")}
              </Button>
            </Badge>
            {anyFilter && (
              <Button type="link" onClick={clearFilters}>
                {t("openings.filters.clear")}
              </Button>
            )}
          </Flex>
          {showFilters && advancedFilters}
          {filters.awaiting_my_approval && (
            <Alert
              type="info"
              showIcon
              title={t("openings.filters.awaitingActive")}
            />
          )}
          {query.isError && (
            <Alert
              type="error"
              title={t("common.loadError")}
              action={
                <Button onClick={() => void query.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          )}
          <Table
            rowKey="opening_number"
            loading={query.isLoading}
            dataSource={query.data?.openings ?? []}
            columns={columns}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("openings.empty")}
                />
              ),
            }}
          />
          <Flex justify="end" gap="small">
            <Button
              icon={<LeftOutlined aria-hidden />}
              disabled={pageIndex === 0 || query.isFetching}
              onClick={() => setPageIndex(pageIndex - 1)}
            >
              {t("common.previous")}
            </Button>
            <Button
              icon={<RightOutlined aria-hidden />}
              iconPlacement="end"
              disabled={!query.data?.next_pagination_key || query.isFetching}
              onClick={() => {
                const key = query.data?.next_pagination_key;
                if (!key) return;
                setPageKeys((old) => [...old.slice(0, pageIndex + 1), key]);
                setPageIndex(pageIndex + 1);
              }}
            >
              {t("common.next")}
            </Button>
          </Flex>
        </Flex>
      </Card>
    </Space>
  );
}
