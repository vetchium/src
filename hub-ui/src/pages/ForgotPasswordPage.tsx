import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const key = useIdempotencyKey();
  const request = useMutation({
    mutationFn: (body: { email_address: string }) =>
      hubAPI.requestPasswordReset(body, key.current()),
    onSuccess: () => key.rotate(),
  });
  return (
    <Card className="auth-card">
      <title>{t("forgotPassword.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <Typography.Title level={1}>
          {t("forgotPassword.title")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("forgotPassword.description")}
        </Typography.Text>
        {request.isSuccess ? (
          <Alert
            type="success"
            showIcon
            title={t("forgotPassword.checkEmail")}
          />
        ) : (
          <>
            <APIErrorAlert error={request.error} />
            <Form<{ email_address: string }>
              layout="vertical"
              onFinish={(values) => request.mutate(values)}
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
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={request.isPending}
              >
                {t("forgotPassword.action")}
              </Button>
            </Form>
          </>
        )}
        <Link to="/login">{t("common.backToSignin")}</Link>
      </Space>
    </Card>
  );
}
