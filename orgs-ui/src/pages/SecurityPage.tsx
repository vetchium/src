import { Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useMyInfoQuery } from "../features/account/queries";
import { ChangePasswordCard } from "../features/security/ChangePasswordCard";
import { TwoFactorCard } from "../features/security/TwoFactorCard";

export function SecurityPage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  if (me === undefined) return null;
  return (
    <Flex orientation="vertical" gap="large">
      <title>{t("security.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("security.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("security.description", { email: me.email_address })}
        </Typography.Text>
      </div>
      <ChangePasswordCard />
      <TwoFactorCard
        totpEnabled={me.totp_enabled}
        recoveryCodesRemaining={me.recovery_codes_remaining}
      />
    </Flex>
  );
}
