import { useMutation } from "@tanstack/react-query";
import { Button, Card, Checkbox, Form, Input, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import type { AuthenticatedSessionResponse } from "../../../typespec/hub/auth/types.ts";
import { hubAPI } from "../api/hub";
import { usePreferences } from "../app/PreferencesContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

interface LoginValues {
  email_address: string;
  password: string;
  remember_me: boolean;
}

interface TFAVerificationValues {
  code: string;
}

export function LoginPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const preferences = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [remembered, setRemembered] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const finishLogin = (
    session: AuthenticatedSessionResponse,
    rememberSession = remembered,
  ) => {
    auth.signIn(session, rememberSession);
    preferences.setLanguage(session.preferred_language);
    const destination =
      (location.state as { from?: string } | null)?.from ?? "/";
    navigate(destination, { replace: true });
  };
  const login = useMutation({
    mutationFn: hubAPI.login,
    onSuccess: (response, values) => {
      setRemembered(values.remember_me ?? false);
      if (response.authentication_state === "totp_required") {
        setChallenge(response.login_challenge_token);
      } else {
        finishLogin(response, values.remember_me ?? false);
      }
    },
  });
  const verify = useMutation({
    mutationFn: ({ code }: TFAVerificationValues) => {
      if (challenge === null) throw new Error("Missing login challenge");
      return useRecoveryCode
        ? hubAPI.verifyRecoveryCode({
            login_challenge_token: challenge,
            recovery_code: code,
          })
        : hubAPI.verifyTFA({
            login_challenge_token: challenge,
            totp_code: code,
          });
    },
    onSuccess: (session) => finishLogin(session),
  });

  return (
    <Card className="auth-card">
      <title>{t("login.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={1}>{t("login.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("login.description")}
          </Typography.Text>
        </div>
        <APIErrorAlert
          error={challenge === null ? login.error : verify.error}
        />
        {challenge === null ? (
          <Form<LoginValues>
            layout="vertical"
            initialValues={{ remember_me: false }}
            onFinish={(values) => login.mutate(values)}
          >
            <Form.Item
              name="email_address"
              label={t("fields.email")}
              rules={[
                {
                  required: true,
                  type: "email",
                  message: t("validation.email"),
                },
              ]}
            >
              <Input autoComplete="email" />
            </Form.Item>
            <Form.Item
              name="password"
              label={t("fields.password")}
              rules={[{ required: true, message: t("validation.required") }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item name="remember_me" valuePropName="checked">
              <Checkbox>{t("login.rememberMe")}</Checkbox>
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={login.isPending}
            >
              {t("login.action")}
            </Button>
          </Form>
        ) : (
          <Form<TFAVerificationValues>
            layout="vertical"
            onFinish={(values) => verify.mutate(values)}
          >
            <Typography.Text>{t("login.tfaDescription")}</Typography.Text>
            <Form.Item
              name="code"
              label={t(
                useRecoveryCode ? "fields.recoveryCode" : "fields.totpCode",
              )}
              rules={[{ required: true, message: t("validation.required") }]}
            >
              <Input autoComplete="one-time-code" inputMode="numeric" />
            </Form.Item>
            <Space orientation="vertical" className="full-width">
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={verify.isPending}
              >
                {t("login.verify")}
              </Button>
              <Button
                type="link"
                block
                onClick={() => setUseRecoveryCode((value) => !value)}
              >
                {t(
                  useRecoveryCode
                    ? "login.useAuthenticator"
                    : "login.useRecoveryCode",
                )}
              </Button>
            </Space>
          </Form>
        )}
        <Space orientation="vertical">
          <Link to="/forgot-password">{t("login.forgotPassword")}</Link>
          <Typography.Text>
            {t("login.noAccount")} <Link to="/signup">{t("login.signup")}</Link>
          </Typography.Text>
        </Space>
      </Space>
    </Card>
  );
}
