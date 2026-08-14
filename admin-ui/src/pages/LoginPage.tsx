import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { LoginRequest } from "../../../typespec/admin/auth/login.ts";
import {
  normalizeLoginRequest,
  validateLoginRequest,
} from "../../../typespec/admin/auth/login.ts";
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

  if (auth.authenticated) {
    return <Navigate replace to={returnTo} />;
  }

  const submit = async (values: LoginRequest) => {
    const request = normalizeLoginRequest(values);
    if (validateLoginRequest(request).length !== 0) {
      return;
    }
    const response = await mutation.mutateAsync(request);
    if (response.authentication_state === "totp_required") {
      auth.beginChallenge(response);
      navigate(`/login/two-factor?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    auth.completeAuthentication(response);
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
        <Link to="/forgot-password">{t("login.forgotPassword")}</Link>
      </Space>
    </Card>
  );
}
