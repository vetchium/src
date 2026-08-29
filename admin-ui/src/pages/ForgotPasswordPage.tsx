import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { RequestPasswordResetRequest } from "typespec/admin/auth/password";
import { normalizeRequestPasswordResetRequest } from "typespec/admin/auth/password";
import { requestPasswordReset } from "../features/auth/api";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const mutation = useMutation({ mutationFn: requestPasswordReset });
  const submit = (values: RequestPasswordResetRequest) =>
    mutation.mutate(normalizeRequestPasswordResetRequest(values));

  return (
    <Card className="auth-card">
      <title>{t("forgotPassword.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={2}>
            {t("forgotPassword.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("forgotPassword.description")}
          </Typography.Text>
        </div>
        {mutation.isSuccess ? (
          <Alert type="success" title={t("forgotPassword.success")} />
        ) : null}
        {mutation.isError ? (
          <Alert type="error" title={t("common.requestError")} />
        ) : null}
        <Form<RequestPasswordResetRequest> layout="vertical" onFinish={submit}>
          <Form.Item
            name="email_address"
            label={t("fields.email")}
            rules={[
              { required: true, type: "email", message: t("validation.email") },
            ]}
          >
            <Input autoComplete="email" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={mutation.isPending}
          >
            {t("forgotPassword.action")}
          </Button>
        </Form>
        <Link to="/login">{t("common.backToLogin")}</Link>
      </Space>
    </Card>
  );
}
