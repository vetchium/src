import { SearchOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Card,
  Flex,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { Job } from "typespec/orgs/marketplace/work/work";
import type { OpeningState } from "typespec/orgs/openings/types";
import { paths } from "../app/paths";
import {
  openingStateColors,
  openingStateLabel,
} from "../features/marketplace/presentation";
import { useJobsQuery } from "../features/marketplace/queries";

const states: OpeningState[] = ["published", "paused", "closed", "expired"];

export function JobsPage() {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();

  const [activeState, setActiveState] = useState<OpeningState>("published");
  const [searchTitle, setSearchTitle] = useState("");
  const [selectedClient, setSelectedClient] = useState<string>();
  const [selectedCountry, setSelectedCountry] = useState<string>();

  const jobsQuery = useJobsQuery({ state: activeState });
  const allJobs = jobsQuery.data?.jobs ?? [];
  const unavailableTenants = jobsQuery.data?.unavailable_tenants ?? [];

  // Derive unique clients and countries from jobs
  const clientOptions = useMemo(() => {
    const clients = new Map<string, string>();
    for (const j of allJobs) {
      if (j.client?.domain) {
        clients.set(j.client.domain, j.client.display_name || j.client.domain);
      }
    }
    return Array.from(clients.entries()).map(([value, label]) => ({
      value,
      label,
    }));
  }, [allJobs]);

  const countryOptions = useMemo(() => {
    const countries = new Set<string>();
    for (const j of allJobs) {
      if (j.opening?.employing_country) {
        countries.add(j.opening.employing_country);
      }
    }
    return Array.from(countries)
      .sort()
      .map((c) => ({
        value: c,
        label: t(`countries.${c}`, { defaultValue: c }),
      }));
  }, [allJobs, t]);

  // Filter jobs client-side by title, client, country
  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      if (searchTitle.trim()) {
        const query = searchTitle.trim().toLowerCase();
        const matchesTitle = job.opening?.title?.toLowerCase().includes(query);
        const matchesNum = String(job.opening?.number ?? "").includes(query);
        if (!matchesTitle && !matchesNum) return false;
      }
      if (selectedClient && job.client?.domain !== selectedClient) {
        return false;
      }
      if (
        selectedCountry &&
        job.opening?.employing_country !== selectedCountry
      ) {
        return false;
      }
      return true;
    });
  }, [allJobs, searchTitle, selectedClient, selectedCountry]);

  const columns: ColumnsType<Job> = [
    {
      title: t("marketplace.jobs.tableOpening"),
      key: "opening",
      render: (_, job) => (
        <div>
          <div>
            <Link
              to={paths.jobDetail(job.engagement_id, job.opening.number)}
              style={{ fontWeight: 500 }}
            >
              {job.opening.title}
            </Link>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            #{job.opening.number}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("marketplace.jobs.tableClient"),
      key: "client",
      render: (_, job) => job.client.display_name || job.client.domain,
    },
    {
      title: t("marketplace.jobs.tableEmployingCountry"),
      key: "employing_country",
      render: (_, job) =>
        job.opening.employing_country
          ? t(`countries.${job.opening.employing_country}`, {
              defaultValue: job.opening.employing_country,
            })
          : "—",
    },
    {
      title: t("marketplace.jobs.tableState"),
      key: "state",
      render: (_, job) => (
        <Tag color={openingStateColors[job.state] ?? "default"}>
          {openingStateLabel(t, job.state)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.jobs.tableAssigned"),
      key: "assigned",
      render: (_, job) => (job.assigned_at ? date(job.assigned_at) : "—"),
    },
    {
      title: t("marketplace.jobs.tableCredited"),
      key: "credited",
      align: "right",
      render: (_, job) => job.credited_count ?? 0,
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          {t("marketplace.jobs.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("marketplace.jobs.subtitle")}
        </Typography.Paragraph>
      </div>

      {unavailableTenants.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t("marketplace.jobs.unavailableNotice", {
            count: unavailableTenants.length,
          })}
        />
      )}

      <Card>
        <Flex vertical gap="middle">
          <Segmented
            value={activeState}
            onChange={(val) => setActiveState(val as OpeningState)}
            options={states.map((st) => ({
              value: st,
              label: `${openingStateLabel(t, st)}${
                activeState === st ? ` (${allJobs.length})` : ""
              }`,
            }))}
          />

          <Flex gap="middle" wrap>
            <Input
              prefix={<SearchOutlined />}
              placeholder={t("marketplace.jobs.searchPlaceholder")}
              value={searchTitle}
              onChange={(e) => setSearchTitle(e.target.value)}
              allowClear
              style={{ maxWidth: 260 }}
            />
            <Select
              placeholder={t("marketplace.jobs.filterClient")}
              allowClear
              value={selectedClient}
              onChange={setSelectedClient}
              options={clientOptions}
              style={{ minWidth: 180 }}
            />
            <Select
              placeholder={t("marketplace.jobs.filterCountry")}
              allowClear
              value={selectedCountry}
              onChange={setSelectedCountry}
              options={countryOptions}
              style={{ minWidth: 180 }}
            />
          </Flex>

          <Table<Job>
            rowKey={(job) => `${job.engagement_id}-${job.opening.number}`}
            columns={columns}
            dataSource={filteredJobs}
            loading={jobsQuery.isLoading}
            pagination={{ pageSize: 20 }}
          />
        </Flex>
      </Card>
    </Space>
  );
}
