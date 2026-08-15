import { Alert, App, Button } from "antd";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { usePendingOperations } from "../../app/PendingOperationContext";

/**
 * Shown when an endpoint refused a sensitive operation because the sign in is
 * older than the accepted age. Signing in again is the only way to refresh it.
 */
export function ReauthenticationAlert() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  // Do not navigate away while another sensitive request still owns the page.
  const { pending } = usePendingOperations();

  const signInAgain = () => {
    if (pending) {
      void message.warning(t("shell.operationInProgress"));
      return;
    }
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/reauthenticate?returnTo=${encodeURIComponent(returnTo)}`, {
      replace: true,
    });
  };

  return (
    <Alert
      type="warning"
      showIcon
      title={t("reauthentication.title")}
      description={t("reauthentication.description")}
      action={
        <Button size="small" disabled={pending} onClick={signInAgain}>
          {t("reauthentication.action")}
        </Button>
      }
    />
  );
}
