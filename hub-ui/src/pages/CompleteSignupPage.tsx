import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { isNewPassword } from "../../../typespec/common/authentication.ts";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePendingOperations } from "../app/PendingOperationContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

interface PasswordValues {
  password: string;
  confirm_password: string;
}

export function CompleteSignupPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const key = useIdempotencyKey(`hub-complete-signup:${token}`);
  const { hold } = usePendingOperations();
  const complete = useMutation({
    mutationFn: async (values: PasswordValues) => {
      const release = hold();
      try {
        return await hubAPI.completeSignup(
          { signup_token: token, password: values.password },
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
      <title>{t("completeSignup.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <Typography.Title level={1}>
          {t("completeSignup.title")}
        </Typography.Title>
        {complete.isSuccess ? (
          <>
            <Alert
              type="success"
              showIcon
              title={t("completeSignup.success", {
                handle: complete.data.handle,
              })}
            />
            <Link to="/login">{t("common.continueToSignin")}</Link>
          </>
        ) : (
          <>
            <APIErrorAlert error={complete.error} />
            <Form<PasswordValues>
              layout="vertical"
              onFinish={(values) => complete.mutate(values)}
            >
              <Form.Item
                name="password"
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
                dependencies={["password"]}
                rules={[
                  { required: true, message: t("validation.required") },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      value === getFieldValue("password")
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
                loading={complete.isPending}
              >
                {t("completeSignup.action")}
              </Button>
            </Form>
          </>
        )}
      </Space>
    </Card>
  );
}
