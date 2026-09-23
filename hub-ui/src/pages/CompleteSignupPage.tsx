import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { isNewPassword } from "typespec/common/authentication";
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
    onSuccess: (result) => {
      if ("handle" in result) key.rotate();
    },
  });

  const awaitingRecovery =
    complete.isSuccess && "operation_id" in complete.data;
  useEffect(() => {
    if (!awaitingRecovery || complete.variables === undefined) return;
    const timer = window.setTimeout(
      () => complete.mutate(complete.variables),
      2000,
    );
    return () => window.clearTimeout(timer);
  }, [awaitingRecovery, complete]);

  return (
    <Card className="auth-card">
      <title>{t("completeSignup.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <Typography.Title level={1}>
          {t("completeSignup.title")}
        </Typography.Title>
        {token.length === 0 ? (
          // A truncated link must say so. A form whose submit
          // button is disabled explains nothing.
          <Alert
            type="error"
            showIcon
            title={t("completeSignup.missingToken")}
          />
        ) : awaitingRecovery ? (
          <Alert type="info" showIcon title={t("completeSignup.pending")} />
        ) : complete.isSuccess && "handle" in complete.data ? (
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
            {complete.isError && (
              <Link to="/signup">{t("signup.changeRegion")}</Link>
            )}
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
