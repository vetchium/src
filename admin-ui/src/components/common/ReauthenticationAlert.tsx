import { Alert, App, Button } from "antd";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { useAuth } from "../../auth/AuthContext";

/**
 * Shown when an endpoint refused a sensitive operation because the sign in is
 * older than the accepted age. Signing in again is the only way to refresh it.
 */
export function ReauthenticationAlert() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { message } = App.useApp();
  // Signing out ends the session an operation in flight was issued under, and
  // anything it returns would then belong to a session that no longer exists.
  const { pending } = usePendingOperations();

  const signInAgain = async () => {
    if (pending) {
      void message.warning(t("shell.operationInProgress"));
      return;
    }
    const returnTo = `${location.pathname}${location.search}`;
    await auth.logout();
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, {
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
        <Button
          size="small"
          disabled={pending}
          onClick={() => void signInAgain()}
        >
          {t("reauthentication.action")}
        </Button>
      }
    />
  );
}
