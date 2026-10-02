import { useMutation } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import { regionFromSearchParams } from "@vetchium/portal-ui/region-selection";
import { Alert, Button, Card, Flex, Form, Input, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { isNewPassword, isOpaqueToken } from "typespec/common/authentication";
import { InvalidPasswordResetTokenError } from "typespec/problem/orgs/authentication";
import { getProblemType, isDefiniteRefusal } from "../api/client";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import { regionStore, regionTable } from "../app/regions";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

interface ResetValues {
  new_password: string;
  confirm_password: string;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const region = regionFromSearchParams(regionTable, search);
  // Persisted per link so that a retry after a lost response replays the
  // reset rather than failing on a token the first attempt already spent.
  const key = useIdempotencyKey(`orgs-password-reset:${token}`);
  const { hold } = usePendingOperations();
  const reset = useMutation({
    mutationFn: async (values: ResetValues) => {
      const release = hold();
      try {
        return await orgsAPI.completePasswordReset(
          { reset_token: token, new_password: values.new_password },
          key.current(),
          region ?? "",
        );
      } finally {
        release();
      }
    },
    onSuccess: () => {
      key.rotate();
      if (region !== null) regionStore.remember(region);
    },
    onError: (error) => {
      if (isDefiniteRefusal(error)) key.rotate();
    },
  });
  const tokenRejected =
    getProblemType(reset.error) === InvalidPasswordResetTokenError.type;

  return (
    <Card className="auth-card">
      <title>{t("resetPassword.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <Typography.Title level={1}>
          {t("resetPassword.title")}
        </Typography.Title>
        {!isOpaqueToken(token) || region === null ? (
          // A truncated link must say so. A form whose submit button is
          // disabled explains nothing.
          <>
            <Alert
              type="error"
              showIcon
              title={t("resetPassword.missingToken")}
            />
            <Link to={paths.forgotPassword}>
              {t("resetPassword.requestAnother")}
            </Link>
          </>
        ) : reset.isSuccess ? (
          <>
            <div data-testid="reset-password-done">
              <Alert
                type="success"
                showIcon
                title={t("resetPassword.success")}
              />
            </div>
            <Link to={paths.login}>{t("common.continueToSignIn")}</Link>
          </>
        ) : (
          <>
            <APIErrorAlert error={reset.error} />
            {tokenRejected ? (
              <Link to={paths.forgotPassword}>
                {t("resetPassword.requestAnother")}
              </Link>
            ) : null}
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
                    validator: (_, value: string | undefined) =>
                      value === undefined ||
                      value === "" ||
                      isNewPassword(value)
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(t("validation.newPassword")),
                          ),
                  },
                ]}
              >
                <Input.Password autoComplete="new-password" maxLength={128} />
              </Form.Item>
              <Form.Item
                name="confirm_password"
                label={t("fields.confirmPassword")}
                dependencies={["new_password"]}
                rules={[
                  { required: true, message: t("validation.required") },
                  ({ getFieldValue }) => ({
                    validator: (_, value: string | undefined) =>
                      value === undefined ||
                      value === "" ||
                      value === getFieldValue("new_password")
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(t("validation.passwordMatch")),
                          ),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" maxLength={128} />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={reset.isPending}
              >
                {t("resetPassword.action")}
              </Button>
            </Form>
          </>
        )}
      </Flex>
    </Card>
  );
}
