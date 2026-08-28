import { useMutation } from "@tanstack/react-query";
import { Button, Card, Checkbox, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { LoginRequest } from "../../../typespec/hub/auth/login.ts";
import { hubAPI } from "../api/hub";
import { useAuth } from "../auth/AuthContext";
import { safeReturnTo } from "../auth/navigation";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

export function LoginPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const returnTo = safeReturnTo(search.get("returnTo"));
  const mutation = useMutation({ mutationFn: hubAPI.login });
  if (auth.authenticated) return <Navigate replace to={returnTo} />;

  const submit = async (request: LoginRequest) => {
    const attempt = auth.beginAttempt();
    let response: Awaited<ReturnType<typeof hubAPI.login>>;
    try {
      response = await mutation.mutateAsync(request);
    } catch {
      return;
    }
    const remembered = request.remember_me ?? false;
    if (response.authentication_state === "totp_required") {
      if (auth.beginChallenge(response, remembered, attempt)) {
        navigate(`/login/two-factor?returnTo=${encodeURIComponent(returnTo)}`, {
          replace: true,
        });
      }
      return;
    }
    if (auth.completeAuthentication(response, remembered, { attempt })) {
      navigate(returnTo, { replace: true });
    }
  };
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
        <APIErrorAlert error={mutation.error} />
        <Form<LoginRequest>
          layout="vertical"
          initialValues={{ remember_me: false }}
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="email_address"
            label={t("fields.email")}
            rules={[
              { required: true, type: "email", message: t("validation.email") },
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
            loading={mutation.isPending}
          >
            {t("login.action")}
          </Button>
        </Form>
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
