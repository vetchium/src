import { Alert, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { DomainStatus } from "typespec/orgs/account/account";
import { useDateTimeFormat } from "../../components/common/useDateTimeFormat";
import { DnsRecord } from "./DnsRecord";
import { DomainCheck } from "./DomainCheck";

export function DomainFailingBanner({
  domain,
  canCheck,
}: {
  domain: DomainStatus;
  canCheck: boolean;
}) {
  const { t } = useTranslation();
  const formatDateTime = useDateTimeFormat();
  return (
    <section
      aria-label={t("domain.failing.region")}
      data-testid="domain-failing-banner"
    >
      <Alert
        type="warning"
        showIcon
        title={t("domain.failing.title", { domain: domain.domain })}
        description={
          <Flex orientation="vertical" gap="middle">
            <Typography.Text>
              {domain.release_after === null
                ? t("domain.failing.description")
                : t("domain.failing.descriptionWithDeadline", {
                    releaseAfter: formatDateTime(domain.release_after),
                  })}
            </Typography.Text>
            <DnsRecord
              name={domain.dns_record_name}
              value={domain.dns_record_value}
            />
            <DomainCheck canCheck={canCheck} />
          </Flex>
        }
      />
    </section>
  );
}
