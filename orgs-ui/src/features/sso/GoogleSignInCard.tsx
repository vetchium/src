import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ReauthenticationAlert } from "@vetchium/portal-ui/shell";
import { Alert, Card, Flex, Switch, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { holds, ManageBilling } from "typespec/orgs/authorization/types";
import { allowsGoogleSignIn } from "typespec/orgs/subscriptions/plans";
import { isRecentAuthenticationRequired } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { paths } from "../../app/paths";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey, useMyInfoQuery } from "../account/queries";
import { mySubscriptionQueryKey } from "../subscriptions/queries";
import { userSummaryQueryKey } from "../users/queries";

export function GoogleSignInCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => orgsAPI.setGoogleSignIn({ enabled }),
    onSuccess: () => {
      // Turning it on lifts the seat cap and turning it off restores it.
      for (const queryKey of [
        myInfoQueryKey,
        mySubscriptionQueryKey,
        userSummaryQueryKey,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  if (me === undefined) return null;
  const entitled = allowsGoogleSignIn(me.plan_oid);
  const stepUp = isRecentAuthenticationRequired(mutation.error);

  return (
    <Card title={t("settings.google.title")} data-testid="google-card">
      <Flex orientation="vertical" gap="middle">
        <Typography.Paragraph type="secondary">
          {t("settings.google.help")}
        </Typography.Paragraph>
        {entitled ? null : (
          <Alert
            type="info"
            showIcon
            data-testid="google-upgrade"
            title={t("settings.google.upgrade")}
            action={
              holds(me.permissions, ManageBilling) ? (
                <Link to={paths.plans}>{t("settings.google.seePlans")}</Link>
              ) : undefined
            }
          />
        )}
        {stepUp ? <ReauthenticationAlert /> : null}
        {stepUp ? null : <APIErrorAlert error={mutation.error} />}
        <Switch
          data-testid="google-switch"
          aria-label={t("settings.google.title")}
          checked={me.google_sign_in_enabled}
          disabled={!entitled}
          loading={mutation.isPending}
          checkedChildren={t("settings.google.on")}
          unCheckedChildren={t("settings.google.off")}
          onChange={(checked) => mutation.mutate(checked)}
        />
      </Flex>
    </Card>
  );
}
