import { Descriptions, Typography } from "antd";
import { useTranslation } from "react-i18next";

export function DnsRecord({ name, value }: { name: string; value: string }) {
  const { t } = useTranslation();
  return (
    <Descriptions
      bordered
      size="small"
      column={1}
      items={[
        {
          key: "type",
          label: t("dnsRecord.type"),
          children: (
            <Typography.Text code>{t("dnsRecord.txt")}</Typography.Text>
          ),
        },
        {
          key: "name",
          label: t("dnsRecord.name"),
          children: (
            <Typography.Text
              code
              copyable={{ text: name }}
              data-testid="dns-record-name"
            >
              {name}
            </Typography.Text>
          ),
        },
        {
          key: "value",
          label: t("dnsRecord.value"),
          children: (
            <Typography.Text
              code
              copyable={{ text: value }}
              data-testid="dns-record-value"
            >
              {value}
            </Typography.Text>
          ),
        },
      ]}
    />
  );
}
