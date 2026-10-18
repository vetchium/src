import { Button, Card, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { holds, ManageBilling } from "typespec/orgs/authorization/types";
import { aiCreditsPerMonth, GoldTier } from "typespec/orgs/subscriptions/plans";
import { paths } from "../../app/paths";
import { useMyInfoQuery } from "../account/queries";

/** Opens Plans for people who may change the plan; nothing for others. */
export function SeePlansButton({
  primary = false,
  small = false,
}: {
  primary?: boolean;
  small?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me } = useMyInfoQuery();
  if (me === undefined || !holds(me.permissions, ManageBilling)) return null;
  return (
    <Button
      type={primary ? "primary" : "default"}
      size={small ? "small" : "middle"}
      onClick={() => navigate(paths.plans)}
    >
      {t("ai.upgrade.seePlans")}
    </Button>
  );
}

/** Whether the signed-in user may change the plan, to word a nudge. */
export function useCanChangePlan(): boolean {
  const { data: me } = useMyInfoQuery();
  return me !== undefined && holds(me.permissions, ManageBilling);
}

/** Takes the place of AI controls for an Org whose plan lacks AI and that
 * has no purchased credits left. */
export function AIUpgradeCard() {
  const { t, i18n } = useTranslation();
  const canChangePlan = useCanChangePlan();
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <Card title={t("ai.upgrade.title")} data-testid="ai-upgrade">
      <Flex vertical gap="middle" align="start">
        <Typography.Text>{t("ai.upgrade.intro")}</Typography.Text>
        <Typography>
          <ul>
            <li>{t("ai.upgrade.drafting")}</li>
            <li>
              {t("ai.upgrade.monthly", {
                credits: number.format(aiCreditsPerMonth(GoldTier)),
              })}
            </li>
            <li>{t("ai.upgrade.packs")}</li>
          </ul>
        </Typography>
        {canChangePlan ? (
          <SeePlansButton primary />
        ) : (
          <Typography.Text type="secondary">
            {t("ai.upgrade.askBilling")}
          </Typography.Text>
        )}
      </Flex>
    </Card>
  );
}
