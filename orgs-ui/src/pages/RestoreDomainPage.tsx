import { Alert, Card, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import { OrgSuspended } from "typespec/orgs/account/account";
import { holds, Superadmin } from "typespec/orgs/authorization/types";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import { DnsRecord } from "../features/domain/DnsRecord";
import { DomainCheck } from "../features/domain/DomainCheck";

export function RestoreDomainPage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  if (me === undefined) return null;
  if (me.org.org_state !== OrgSuspended) {
    return <Navigate replace to={paths.home} />;
  }
  const { domain } = me.org.domain;

  return (
    <Flex orientation="vertical" gap="large" data-testid="restore-domain">
      <title>{t("restore.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("restore.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("restore.description", { domain })}
        </Typography.Text>
      </div>
      <Alert
        type="error"
        showIcon
        title={t("restore.suspended", { domain })}
        description={t("restore.suspendedDetail")}
      />
      <Card title={t("restore.recordCard")}>
        <Flex orientation="vertical" gap="middle">
          <Typography.Text>{t("restore.publish", { domain })}</Typography.Text>
          <DnsRecord
            name={me.org.domain.dns_record_name}
            value={me.org.domain.dns_record_value}
          />
          <Typography.Text type="secondary">
            {t("restore.claimedElsewhere")}
          </Typography.Text>
          <DomainCheck canCheck={holds(me.permissions, Superadmin)} />
        </Flex>
      </Card>
    </Flex>
  );
}
