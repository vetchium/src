import { Card, Col, Descriptions, Flex, Row, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  DomainFailing,
  DomainReleased,
  type DomainVerificationState,
  DomainVerified,
} from "typespec/orgs/account/account";
import {
  type OrgPermission,
  type OrgPermissionID,
  orgPermissions,
} from "typespec/orgs/authorization/types";
import { useDateTimeFormat } from "../components/common/useDateTimeFormat";
import { useMyInfoQuery } from "../features/account/queries";

const stateColors: Record<DomainVerificationState, string> = {
  [DomainVerified]: "green",
  [DomainFailing]: "orange",
  [DomainReleased]: "red",
};

function isDefinedPermission(value: OrgPermissionID): value is OrgPermission {
  return (orgPermissions as readonly string[]).includes(value);
}

export function HomePage() {
  const { t } = useTranslation();
  const formatDateTime = useDateTimeFormat();
  const { data: me } = useMyInfoQuery();
  if (me === undefined) return null;
  const { org } = me;
  const { domain } = org;

  return (
    <Flex orientation="vertical" gap="large">
      <title>{t("home.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{org.display_name}</Typography.Title>
        <Typography.Text type="secondary">
          {t("home.description")}
        </Typography.Text>
      </div>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card title={t("home.domainCard")}>
            <Descriptions
              column={1}
              items={[
                {
                  key: "domain",
                  label: t("fields.domain"),
                  children: (
                    <Typography.Text strong data-testid="home-domain">
                      {domain.domain}
                    </Typography.Text>
                  ),
                },
                {
                  key: "state",
                  label: t("fields.domainState"),
                  children: (
                    <Tag
                      color={stateColors[domain.state]}
                      data-testid="home-domain-state"
                      data-state={domain.state}
                    >
                      {t(`domain.states.${domain.state}`)}
                    </Tag>
                  ),
                },
                {
                  key: "verified",
                  label: t("fields.lastVerified"),
                  children: formatDateTime(domain.last_verified_at),
                },
                ...(domain.failing_since === null
                  ? []
                  : [
                      {
                        key: "failing",
                        label: t("fields.failingSince"),
                        children: formatDateTime(domain.failing_since),
                      },
                    ]),
                ...(domain.release_after === null
                  ? []
                  : [
                      {
                        key: "release",
                        label: t("fields.releaseAfter"),
                        children: formatDateTime(domain.release_after),
                      },
                    ]),
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title={t("home.accountCard")}>
            <Descriptions
              column={1}
              items={[
                {
                  key: "permissions",
                  label: t("fields.permissions"),
                  children:
                    me.permissions.length === 0 ? (
                      t("home.noPermissions")
                    ) : (
                      <Flex gap="small" wrap data-testid="home-permissions">
                        {me.permissions.map((permission) => (
                          <Tag key={permission}>
                            {isDefinedPermission(permission)
                              ? t(`permissions.${permission}.name`)
                              : permission}
                          </Tag>
                        ))}
                      </Flex>
                    ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}
