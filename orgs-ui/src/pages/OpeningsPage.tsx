import { PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { countryCodeValues } from "typespec/common/countries";
import type { PaginationKey } from "typespec/common/pagination";
import { holds, ManageOpenings } from "typespec/orgs/authorization/types";
import type { ListOpeningsRequest } from "typespec/orgs/openings/openings";
import {
  type OrgOpeningSummary,
  openingRequestKinds,
  openingStates,
} from "typespec/orgs/openings/types";
import { APIError } from "../api/client";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import {
  useOpeningSummaryQuery,
  useOpeningsQuery,
} from "../features/openings/queries";

const pageSize = 25;

export function OpeningsPage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const [filters, setFilters] = useState<ListOpeningsRequest>({});
  const [titleInput, setTitleInput] = useState("");
  const [managerInput, setManagerInput] = useState("");
  const [recruiterInput, setRecruiterInput] = useState("");
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const summary = useOpeningSummaryQuery();
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
  const columns: ColumnsType<OrgOpeningSummary> = [
    {
      title: t("openings.number"),
      dataIndex: "opening_number",
      render: (number: number) => (
        <Link to={paths.openingDetail(number)}>#{number}</Link>
      ),
    },
    {
      title: t("openings.fields.title"),
      dataIndex: "title",
      render: (title?: string) => title ?? t("openings.untitled"),
    },
    {
      title: t("openings.fields.state"),
      dataIndex: "state",
      render: (state: string) => <Tag>{t(`openings.states.${state}`)}</Tag>,
    },
    {
      title: t("openings.fields.country"),
      dataIndex: "employing_country",
      render: (code?: string) => {
        if (!code) return "";
        try {
          return countryNames.of(code) ?? code;
        } catch {
          return code;
        }
      },
    },
    {
      title: t("openings.fields.hiringManager"),
      dataIndex: "hiring_manager_email",
    },
    {
      title: t("openings.fields.updated"),
      dataIndex: "updated_at",
      render: (value: string) => new Date(value).toLocaleString(),
    },
  ];

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("openings.documentTitle")}</title>
      <Flex align="center" justify="space-between" wrap gap="middle">
        <Typography.Title level={1}>{t("openings.title")}</Typography.Title>
        {me && holds(me.permissions, ManageOpenings) && (
          <Link to={paths.newOpening}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              aria-label={t("openings.new")}
            >
              {t("openings.new")}
            </Button>
          </Link>
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
        <Card loading={summary.isLoading}>
          <Flex gap="large" wrap>
            <Typography.Text>
              {t("openings.quota", {
                used: summary.data.quota.used,
                limit: summary.data.quota.limit,
              })}
            </Typography.Text>
            {summary.data.counts.map(({ state, count }) => (
              <Typography.Text key={state}>
                {t(`openings.states.${state}`)}: {count}
              </Typography.Text>
            ))}
          </Flex>
        </Card>
      )}
      <Flex gap="small" wrap>
        <Select
          mode="multiple"
          aria-label={t("openings.filters.states")}
          placeholder={t("openings.filters.states")}
          value={filters.states}
          onChange={(value) =>
            setFilter("states", value.length ? value : undefined)
          }
          options={openingStates.map((value) => ({
            value,
            label: t(`openings.states.${value}`),
          }))}
          style={{ minWidth: 180 }}
          allowClear
        />
        <Select
          mode="multiple"
          aria-label={t("openings.filters.pendingKinds")}
          placeholder={t("openings.filters.pendingKinds")}
          value={filters.pending_request_kinds}
          onChange={(value) =>
            setFilter("pending_request_kinds", value.length ? value : undefined)
          }
          options={openingRequestKinds.map((value) => ({
            value,
            label: t(`openings.requestKinds.${value}`),
          }))}
          style={{ minWidth: 190 }}
          allowClear
        />
        <Select
          aria-label={t("openings.filters.awaitingApproval")}
          placeholder={t("openings.filters.awaitingApproval")}
          value={filters.awaiting_my_approval}
          onChange={(value) => setFilter("awaiting_my_approval", value)}
          options={[
            { value: true, label: t("openings.filters.awaitingApproval") },
          ]}
          style={{ minWidth: 190 }}
          allowClear
        />
        <Input.Search
          aria-label={t("openings.filters.hiringManager")}
          placeholder={t("openings.filters.hiringManager")}
          value={managerInput}
          onChange={(event) => setManagerInput(event.target.value)}
          onSearch={(value) =>
            setFilter("hiring_manager_email", value.trim() || undefined)
          }
          style={{ width: 190 }}
        />
        <Input.Search
          aria-label={t("openings.filters.recruiter")}
          placeholder={t("openings.filters.recruiter")}
          value={recruiterInput}
          onChange={(event) => setRecruiterInput(event.target.value)}
          onSearch={(value) =>
            setFilter("recruiter_email", value.trim() || undefined)
          }
          style={{ width: 190 }}
        />
        <Select
          showSearch
          aria-label={t("openings.fields.country")}
          placeholder={t("openings.fields.country")}
          value={filters.employing_country}
          onChange={(value) => setFilter("employing_country", value)}
          options={countryCodeValues.map((value) => ({
            value,
            label: countryNames.of(value) ?? value,
          }))}
          optionFilterProp="label"
          style={{ minWidth: 180 }}
          allowClear
        />
        <Select
          aria-label={t("openings.fields.workArrangement")}
          placeholder={t("openings.fields.workArrangement")}
          value={filters.work_arrangement}
          onChange={(value) => setFilter("work_arrangement", value)}
          options={["on_site", "hybrid", "remote"].map((value) => ({
            value,
            label: t(`openings.workArrangements.${value}`),
          }))}
          style={{ minWidth: 180 }}
          allowClear
        />
        <Select
          aria-label={t("openings.fields.employmentType")}
          placeholder={t("openings.fields.employmentType")}
          value={filters.employment_type}
          onChange={(value) => setFilter("employment_type", value)}
          options={["full_time", "part_time", "contract", "internship"].map(
            (value) => ({
              value,
              label: t(`openings.employmentTypes.${value}`),
            }),
          )}
          style={{ minWidth: 180 }}
          allowClear
        />
        <Input.Search
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
          style={{ width: 220 }}
        />
        <Button
          onClick={() => {
            setTitleInput("");
            setManagerInput("");
            setRecruiterInput("");
            applyFilters({});
          }}
        >
          {t("openings.filters.clear")}
        </Button>
      </Flex>
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
        locale={{ emptyText: t("openings.empty") }}
      />
      <Flex justify="end" gap="small">
        <Button
          disabled={pageIndex === 0 || query.isFetching}
          onClick={() => setPageIndex(pageIndex - 1)}
        >
          {t("common.previous")}
        </Button>
        <Button
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
    </Space>
  );
}
