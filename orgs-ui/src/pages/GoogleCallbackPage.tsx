import { safeReturnTo } from "@vetchium/portal-ui/navigation";
import { Alert, Button, Card, Flex, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isDefiniteRefusal } from "../api/client";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import { regionTable } from "../app/regions";
import { useAuth } from "../auth/AuthContext";
import { problemMessage } from "../components/common/APIErrorAlert";
import { takeGoogleSignIn } from "../features/sso/pending";

/**
 * Where Google sends the browser back. The state is single use, so the
 * exchange runs exactly once even if React mounts the effect twice. Every
 * failure the user can cause reads the same: whether the code, the account or
 * the Org was at fault is not for the browser to learn.
 */
export function GoogleCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const started = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = takeGoogleSignIn((tenantId) =>
      regionTable.regions.some((region) => region.tenantId === tenantId),
    );
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (pending === null || !code || !state) {
      setFailed(true);
      return;
    }
    const current = authRef.current;
    const attempt = current.beginAttempt();
    orgsAPI
      .completeGoogleSignIn({ state, code }, pending.tenantId)
      .then((session) => {
        if (
          !authRef.current.completeAuthentication(
            session,
            { tenantId: pending.tenantId },
            { attempt },
          )
        ) {
          return;
        }
        navigate(safeReturnTo(pending.returnTo), { replace: true });
      })
      .catch((reason: unknown) => {
        // A response that never arrived is not a refusal; the state may be
        // spent either way, so both end at the same retryable screen.
        if (isDefiniteRefusal(reason)) setError(reason);
        setFailed(true);
      });
  }, [navigate, searchParams]);

  if (!failed) return <Spin fullscreen size="large" />;
  return (
    <Card className="auth-card">
      <title>{t("googleCallback.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <Typography.Title level={1}>
          {t("googleCallback.title")}
        </Typography.Title>
        <Alert
          type="error"
          showIcon
          data-testid="google-failed"
          title={
            error === null
              ? t("googleCallback.failed")
              : problemMessage(t, error)
          }
        />
        <Link to={paths.login}>
          <Button block>{t("googleCallback.back")}</Button>
        </Link>
      </Flex>
    </Card>
  );
}
