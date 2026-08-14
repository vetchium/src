import { Card, Descriptions, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useMyInfoQuery } from "../features/profile/queries";

export function HomePage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMyInfoQuery();
  if (me === undefined) return null;
  const primaryName =
    me.display_names.find(
      (name) => name.language_code === me.primary_display_name_language,
    )?.display_name ?? me.email_address;
  const authorization = me.is_superadmin
    ? t("home.superadmin")
    : me.permissions.length > 0
      ? me.permissions
          .map((permission) => t(`permissions.${permission}`))
          .join(", ")
      : t("home.noPermissions");

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <div>
        <Typography.Title level={1}>
          {t("home.title", { name: primaryName })}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("home.description")}
        </Typography.Text>
      </div>
      <Card title={t("home.accountCard")}>
        <Descriptions
          column={{ xs: 1, sm: 2 }}
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
              children: authorization,
            },
            {
              key: "state",
              label: t("fields.state"),
              children: <Tag color="green">{t(`states.${me.state}`)}</Tag>,
            },
            {
              key: "language",
              label: t("fields.language"),
              children: t(`languages.${me.effective_language}`),
            },
            {
              key: "timezone",
              label: t("fields.timezone"),
              children: me.effective_timezone,
            },
            {
              key: "totp",
              label: t("fields.twoFactor"),
              children: me.totp_enabled
                ? t("common.enabled")
                : t("common.disabled"),
            },
            {
              key: "expires",
              label: t("fields.sessionExpires"),
              children: new Intl.DateTimeFormat(i18n.language, {
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
