import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { isNewPassword } from "typespec/common/authentication";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePendingOperations } from "../app/PendingOperationContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

interface ResetValues {
  new_password: string;
  confirm_password: string;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const key = useIdempotencyKey(`hub-password-reset:${token}`);
  const { hold } = usePendingOperations();
  const reset = useMutation({
    mutationFn: async (values: ResetValues) => {
      const release = hold();
      try {
        return await hubAPI.completePasswordReset(
          {
            reset_token: token,
            new_password: values.new_password,
          },
          key.current(),
        );
      } finally {
        release();
      }
    },
    onSuccess: () => key.rotate(),
  });
  return (
    <Card className="auth-card">
      <title>{t("resetPassword.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <Typography.Title level={1}>
          {t("resetPassword.title")}
        </Typography.Title>
        {reset.isSuccess ? (
          <>
            <Alert type="success" showIcon title={t("resetPassword.success")} />
            <Link to="/login">{t("common.continueToSignin")}</Link>
          </>
        ) : (
          <>
            <APIErrorAlert error={reset.error} />
            <Form<ResetValues>
              layout="vertical"
              onFinish={(values) => reset.mutate(values)}
            >
              <Form.Item
                name="new_password"
                label={t("fields.newPassword")}
                rules={[
                  { required: true, message: t("validation.required") },
                  {
                    validator: (_, value) =>
                      isNewPassword(value ?? "")
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(t("validation.newPassword")),
                          ),
                  },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm_password"
                label={t("fields.confirmPassword")}
                dependencies={["new_password"]}
                rules={[
                  { required: true, message: t("validation.required") },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      value === getFieldValue("new_password")
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(t("validation.passwordMatch")),
                          ),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                disabled={token.length === 0}
                loading={reset.isPending}
              >
                {t("resetPassword.action")}
              </Button>
            </Form>
          </>
        )}
      </Space>
    </Card>
  );
}
