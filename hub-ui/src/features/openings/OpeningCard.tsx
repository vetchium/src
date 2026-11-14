import {
  ClockCircleOutlined,
  EnvironmentOutlined,
  LaptopOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  OpeningTagList,
  openingTagName,
} from "@vetchium/portal-ui/opening-tags";
import { Avatar, Card, Flex, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
  PublicOpeningSummary,
  PublicOrg,
} from "typespec/hub/openings/public";
import type { FrontendLocale } from "typespec/hub/types";
import { countryName } from "../../i18n/countries";
import { formatSalary } from "./presentation";
import { useOpeningTags } from "./queries";

/**
 * One Opening in a list. `org` adds the Org's logo and name, for lists that
 * mix Orgs; the Org page omits it because its header already names the Org.
 */
export function OpeningCard({
  opening,
  domain,
  org,
}: {
  opening: PublicOpeningSummary;
  domain: string;
  org?: PublicOrg;
}) {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const tags = useOpeningTags();
  const orgPath = `/org/${encodeURIComponent(domain)}`;
  return (
    <Card size="small">
      <Flex vertical gap="small">
        {org && (
          <Flex gap="small" align="center">
            <Avatar shape="square" src={org.logo_url} alt="" aria-hidden>
              {[...org.display_name][0]}
            </Avatar>
            <Link to={orgPath}>{org.display_name}</Link>
          </Flex>
        )}
        <Link to={`${orgPath}/openings/${opening.opening_number}`}>
          <Typography.Title level={4}>{opening.title}</Typography.Title>
        </Link>
        <Flex gap="small" wrap align="center">
          <Tag icon={<EnvironmentOutlined aria-hidden />} variant="filled">
            {countryName(
              opening.employing_country,
              i18n.language as FrontendLocale,
            )}
          </Tag>
          <Tag icon={<LaptopOutlined aria-hidden />} variant="filled">
            {t(`orgPage.workArrangements.${opening.work_arrangement}`, {
              defaultValue: opening.work_arrangement,
            })}
          </Tag>
          <Tag icon={<ClockCircleOutlined aria-hidden />} variant="filled">
            {t(`orgPage.employmentTypes.${opening.employment_type}`, {
              defaultValue: opening.employment_type,
            })}
          </Tag>
          {opening.salary && (
            <Tag icon={<WalletOutlined aria-hidden />} variant="filled">
              {formatSalary(t, i18n.language, opening.salary)}
            </Tag>
          )}
          <Typography.Text type="secondary">
            {t("orgPage.posted", {
              date: date(opening.first_published_at, "medium"),
            })}
          </Typography.Text>
        </Flex>
        <OpeningTagList
          tags={opening.tags}
          name={(oid) => openingTagName(tags.catalog, oid, i18n.language)}
          label={t("orgPage.fields.tags")}
        />
      </Flex>
    </Card>
  );
}
