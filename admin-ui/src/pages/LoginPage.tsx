import { useMutation } from "@tanstack/react-query";
import { Alert, App, Button, Card, Form, Input, Space, Typography } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { LoginRequest } from "../../../typespec/admin/auth/login.ts";
import {
  normalizeLoginRequest,
  validateLoginRequest,
} from "../../../typespec/admin/auth/login.ts";
import { usePendingOperations } from "../app/PendingOperationContext";
import type { LoginAttempt } from "../auth/AuthContext";
import { useAuth } from "../auth/AuthContext";
import { safeReturnTo } from "../auth/navigation";
import { login } from "../features/auth/api";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const mutation = useMutation({ mutationFn: login });
  const { message } = App.useApp();
  // A verification in flight still owns the challenge it is about to spend.
  // Superseding it from here — by starting another sign in, or by abandoning
  // the challenge on the way to a password reset — would make the server
  // consume that recovery code for a result this client then refuses.
  const { pending } = usePendingOperations();
  const supersedingBlocked = () => {
    if (!pending) {
      return false;
    }
    void message.warning(t("shell.operationInProgress"));
    return true;
  };
  // An attempt whose response has not been handed off yet still owns nothing.
  // Leaving the page abandons it, so its response cannot install a session or a
  // challenge behind the user's back — which would otherwise collide with a
  // password reset or account setup they went on to complete. Handing off first
  // is what keeps an ordinary sign in, which also unmounts this page, intact.
  const unhandedAttempt = useRef<LoginAttempt | null>(null);
  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(
    () => () => {
      if (unhandedAttempt.current !== null) {
        authRef.current.clearChallenge();
      }
    },
    [],
  );

  if (auth.authenticated) {
    return <Navigate replace to={returnTo} />;
  }

  const submit = async (values: LoginRequest) => {
    if (supersedingBlocked()) {
      return;
    }
    const request = normalizeLoginRequest(values);
    if (validateLoginRequest(request).length !== 0) {
      return;
    }
    // Claimed before the request so that a response arriving after the user has
    // started another sign in is discarded rather than allowed to replace it.
    const attempt = auth.beginAttempt();
    unhandedAttempt.current = attempt;
    let response: Awaited<ReturnType<typeof login>>;
    try {
      response = await mutation.mutateAsync(request);
    } catch {
      return;
    }
    if (response.authentication_state === "totp_required") {
      if (!auth.beginChallenge(response, undefined, attempt)) {
        return;
      }
      unhandedAttempt.current = null;
      navigate(`/login/two-factor?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (!auth.completeAuthentication(response, undefined, { attempt })) {
      return;
    }
    unhandedAttempt.current = null;
    navigate(returnTo, { replace: true });
  };

  return (
    <Card className="auth-card">
      <title>{t("login.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={2}>{t("login.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("login.description")}
          </Typography.Text>
        </div>
        {mutation.isError ? (
          <Alert type="error" title={t("login.error")} />
        ) : null}
        <Form<LoginRequest>
          layout="vertical"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="email_address"
            label={t("fields.email")}
            rules={[
              { required: true, type: "email", message: t("validation.email") },
            ]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("fields.password")}
            rules={[{ required: true, message: t("validation.required") }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={mutation.isPending}
          >
            {t("login.action")}
          </Button>
        </Form>
        {/* Leaving for a password reset abandons the sign in, so a response
            still in flight cannot pull the user back into it. */}
        <Link
          to="/forgot-password"
          onClick={(event) => {
            if (supersedingBlocked()) {
              event.preventDefault();
              return;
            }
            auth.clearChallenge();
          }}
        >
          {t("login.forgotPassword")}
        </Link>
      </Space>
    </Card>
  );
}
