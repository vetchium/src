import { useMutation } from "@tanstack/react-query";
import { Button, Card, Form, Input, Radio, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import {
  isTOTPRecoveryCode,
  type TOTPRecoveryCode,
} from "typespec/common/authentication";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePendingOperations } from "../app/PendingOperationContext";
import { useAuth } from "../auth/AuthContext";
import { safeReturnTo } from "../auth/navigation";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

export function TwoFactorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const auth = useAuth();
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const totpKey = useIdempotencyKey();
  const recoveryKey = useIdempotencyKey();
  const { hold, pending } = usePendingOperations();
  const mutation = useMutation({
    mutationFn: async ({ code }: { code: string }) => {
      const challenge = auth.pendingChallenge;
      if (challenge === null) throw new Error("Missing login challenge");
      return method === "totp"
        ? hubAPI.verifyTFA(
            {
              login_challenge_token: challenge.login_challenge_token,
              totp_code: code,
            },
            totpKey.current(),
          )
        : hubAPI.verifyRecoveryCode(
            {
              login_challenge_token: challenge.login_challenge_token,
              recovery_code: code,
            },
            recoveryKey.current(),
          );
    },
  });
  if (auth.pendingChallenge === null) return <Navigate replace to="/login" />;

  const submit = async (values: { code: string }) => {
    const challenge = auth.pendingChallenge;
    if (
      challenge === null ||
      Date.parse(challenge.login_challenge_expires_at) <= Date.now()
    ) {
      auth.clearChallenge();
      navigate("/login", { replace: true });
      return;
    }
    const release = hold();
    try {
      const session = await mutation.mutateAsync(values);
      if (
        auth.completeAuthentication(session, challenge.remembered, {
          challenge: challenge.login_challenge_token,
        })
      ) {
        navigate(safeReturnTo(search.get("returnTo")), { replace: true });
      }
    } catch {
    } finally {
      release();
    }
  };
  return (
    <Card className="auth-card">
      <title>{t("twoFactor.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={1}>{t("twoFactor.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("twoFactor.description")}
          </Typography.Text>
        </div>
        <Radio.Group
          block
          value={method}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: t("twoFactor.authenticator"), value: "totp" },
            { label: t("twoFactor.recovery"), value: "recovery" },
          ]}
          onChange={(event) => {
            mutation.reset();
            setMethod(event.target.value as "totp" | "recovery");
          }}
        />
        {mutation.error ? <APIErrorAlert error={mutation.error} /> : null}
        <Form<{ code: string }>
          layout="vertical"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="code"
            label={
              method === "totp"
                ? t("fields.totpCode")
                : t("fields.recoveryCode")
            }
            rules={[
              { required: true, message: t("validation.required") },
              ...(method === "totp"
                ? [{ pattern: /^\d{6}$/, message: t("validation.totp") }]
                : [
                    {
                      validator: (
                        _: unknown,
                        value: TOTPRecoveryCode | undefined,
                      ) =>
                        value === undefined ||
                        value === "" ||
                        isTOTPRecoveryCode(value)
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error(t("validation.recoveryCode")),
                            ),
                    },
                  ]),
            ]}
          >
            <Input
              autoComplete="one-time-code"
              inputMode={method === "totp" ? "numeric" : "text"}
              maxLength={method === "totp" ? 6 : 128}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={mutation.isPending}
          >
            {t("twoFactor.action")}
          </Button>
        </Form>
        <Button
          type="link"
          disabled={pending}
          onClick={() => {
            auth.clearChallenge();
            navigate("/login");
          }}
        >
          {t("twoFactor.restart")}
        </Button>
      </Space>
    </Card>
  );
}
