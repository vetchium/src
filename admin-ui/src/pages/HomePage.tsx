import { Card, Descriptions, Grid, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { intlLocale } from "../app/preferences";
import {
  permissionNameKey,
  permissionRows,
} from "../features/authorization/permissions";
import { useMyInfoQuery } from "../features/profile/queries";

export function HomePage() {
  const { t, i18n } = useTranslation();
  const screens = Grid.useBreakpoint();
  const { data: me } = useMyInfoQuery();
  if (me === undefined) return null;
  const granted = permissionRows(me.permissions).filter((row) => row.selected);

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <div>
        <Typography.Title level={1}>
          {t("home.title", { name: me.display_name })}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("home.description")}
        </Typography.Text>
      </div>
      <Card title={t("home.accountCard")}>
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          layout={screens.sm === true ? "horizontal" : "vertical"}
          items={[
            {
              key: "email",
              label: t("fields.email"),
              children: me.email_address,
            },
            {
              key: "tenant",
              label: t("fields.tenant"),
              children: me.tenant_id,
            },
            {
              key: "authorization",
              label: t("fields.access"),
              children:
                granted.length === 0 ? (
                  t("users.access.none")
                ) : (
                  <Space size={[0, 4]} wrap>
                    {granted.map((row) => (
                      <Tag
                        key={row.permission}
                        color={row.impliedBy.length === 0 ? "blue" : undefined}
                      >
                        {row.defined
                          ? t(permissionNameKey(row.permission))
                          : row.permission}
                      </Tag>
                    ))}
                  </Space>
                ),
            },
            {
              key: "state",
              label: t("fields.state"),
              children: <Tag color="green">{t(`states.${me.state}`)}</Tag>,
            },
            {
              key: "language",
              label: t("fields.language"),
              children: t(`languages.${me.preferred_language}`),
            },
            {
              key: "totp",
              label: t("fields.twoFactor"),
              children: me.totp_enabled
                ? t("common.enabled")
                : t("common.disabled"),
            },
            ...(me.totp_enabled
              ? [
                  {
                    key: "recoveryCodes",
                    label: t("fields.recoveryCodes"),
                    children: me.recovery_codes_remaining,
                  },
                ]
              : []),
            {
              key: "expires",
              label: t("fields.sessionExpires"),
              children: new Intl.DateTimeFormat(intlLocale(i18n.language), {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(me.session_expires_at)),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
