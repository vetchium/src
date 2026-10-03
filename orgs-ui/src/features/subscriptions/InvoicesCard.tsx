import { Alert, Button, Card, Flex, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaginationKey } from "typespec/common/pagination";
import type { OrgInvoice } from "typespec/orgs/subscriptions/subscriptions";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { formatDate } from "./format";
import { planLabel } from "./labels";
import { useInvoicesQuery, usePayInvoice } from "./queries";

const stateColors = { paid: "green", open: "red", void: "default" } as const;

export function InvoicesCard({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [index, setIndex] = useState(0);
  const query = useInvoicesQuery(keys[index]);
  const pay = usePayInvoice();
  const invoices = query.data?.invoices ?? [];

  const columns: ColumnsType<OrgInvoice> = [
    {
      title: t("plans.invoices.period"),
      key: "period",
      render: (_, invoice) =>
        `${formatDate(invoice.period_start, locale)} – ${formatDate(invoice.period_end, locale)}`,
    },
    {
      title: t("plans.invoices.plan"),
      key: "plan",
      render: (_, invoice) =>
        `${planLabel(t, invoice.plan_oid)} · ${t(`plans.interval.${invoice.billing_interval}`)}`,
    },
    {
      title: t("plans.invoices.reason"),
      key: "reason",
      responsive: ["md"],
      render: (_, invoice) => t(`plans.invoices.reasons.${invoice.reason}`),
    },
    {
      title: t("plans.invoices.state"),
      key: "state",
      render: (_, invoice) => (
        <Tag color={stateColors[invoice.state]} data-testid="invoice-state">
          {t(`plans.invoices.states.${invoice.state}`)}
        </Tag>
      ),
    },
    {
      title: t("plans.invoices.actions"),
      key: "actions",
      render: (_, invoice) =>
        invoice.state === "open" ? (
          <Button
            danger
            size="small"
            loading={pay.isPending}
            onClick={() => pay.mutate(invoice)}
          >
            {t("plans.current.payNow")}
          </Button>
        ) : null,
    },
  ];

  return (
    <Card title={t("plans.invoices.title")} data-testid="invoices">
      <Flex orientation="vertical" gap="middle">
        <APIErrorAlert error={pay.error} />
        {query.isError ? (
          <Alert type="error" title={t("common.loadError")} />
        ) : null}
        <Table<OrgInvoice>
          rowKey="invoice_id"
          size="small"
          columns={columns}
          dataSource={invoices}
          loading={query.isPending}
          pagination={false}
          locale={{ emptyText: t("plans.invoices.empty") }}
        />
        <Flex justify="space-between" align="center">
          <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>
            {t("common.previous")}
          </Button>
          <Typography.Text type="secondary">
            {t("users.page", { page: index + 1 })}
          </Typography.Text>
          <Button
            disabled={query.data?.next_pagination_key === undefined}
            onClick={() => {
              const next = query.data?.next_pagination_key;
              if (next === undefined) return;
              setKeys([...keys.slice(0, index + 1), next]);
              setIndex(index + 1);
            }}
          >
            {t("common.next")}
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
}
