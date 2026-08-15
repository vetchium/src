import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Radio,
  Space,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import type {
  TOTPCode,
  TOTPRecoveryCode,
} from "../../../typespec/common/authentication.ts";
import { isTOTPRecoveryCode } from "../../../typespec/common/authentication.ts";
import { useIdempotencyKey } from "../api/idempotency";
import { problemTranslationKey } from "../api/problems";
import { usePendingOperations } from "../app/PendingOperationContext";
import { useAuth } from "../auth/AuthContext";
import { safeReturnTo } from "../auth/navigation";
import { verifyRecoveryCode, verifyTFA } from "../features/auth/api";

interface CodeForm {
  code: string;
}

export function TwoFactorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  // Verifying consumes the login challenge, and a recovery code besides, so a
  // retry after a lost response has to replay the session it already issued
  // rather than spend a second code on a challenge that is now gone.
  // Deliberately NOT persisted across unmount, unlike the reset and invitation
  // keys. Replay requires the identical request, and the code that went with
  // this key cannot be restored without storing the credential itself. A key
  // that outlived the page would only turn "invalid challenge" into an
  // idempotency conflict. It still covers the retry that matters, where the
  // page and its entered code are both still there.
  const totpKey = useIdempotencyKey();
  const recoveryKey = useIdempotencyKey();
  // This page's own verification is what normally holds, but reading the
  // shared flag keeps the rule the same everywhere: nothing supersedes an
  // operation that is still spending a credential.
  const { hold, pending } = usePendingOperations();
  const mutation = useMutation({
    mutationFn: async ({ code }: CodeForm) => {
      const challenge = auth.pendingChallenge;
      if (challenge === null) {
        throw new Error("Missing login challenge");
      }
      if (method === "totp") {
        return verifyTFA(
          {
            login_challenge_token: challenge.login_challenge_token,
            totp_code: code as TOTPCode,
          },
          totpKey.current(),
        );
      }
      return verifyRecoveryCode(
        {
          login_challenge_token: challenge.login_challenge_token,
          recovery_code: code as TOTPRecoveryCode,
        },
        recoveryKey.current(),
      );
    },
  });

  if (auth.pendingChallenge === null) {
    return <Navigate replace to="/login" />;
  }

  const submit = async (values: CodeForm) => {
    const challenge = auth.pendingChallenge;
    if (
      challenge === null ||
      new Date(challenge.login_challenge_expires_at).getTime() <= Date.now()
    ) {
      auth.clearChallenge();
      navigate("/login", { replace: true });
      return;
    }
    const release = hold();
    let session: Awaited<ReturnType<typeof mutation.mutateAsync>>;
    try {
      session = await mutation.mutateAsync(values);
    } catch {
      return;
    } finally {
      release();
    }
    // The user may have restarted, or begun a second sign in, while this was in
    // flight. That flow now owns the portal, so this response is discarded.
    if (
      !auth.completeAuthentication(session, {
        challenge: challenge.login_challenge_token,
      })
    ) {
      return;
    }
    navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
  };

  return (
    <Card className="auth-card">
      <title>{t("twoFactor.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={2}>{t("twoFactor.title")}</Typography.Title>
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
          onChange={(event) =>
            setMethod(event.target.value as "totp" | "recovery")
          }
        />
        {mutation.isError ? (
          <Alert
            type="error"
            title={t(
              problemTranslationKey(mutation.error, {}, "twoFactor.error"),
            )}
          />
        ) : null}
        <Form<CodeForm>
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
                ? [{ pattern: /^\d{6}$/, message: t("validation.totpCode") }]
                : [
                    {
                      validator: (_: unknown, value: string | undefined) =>
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
              maxLength={method === "totp" ? 6 : 128}
              inputMode={method === "totp" ? "numeric" : "text"}
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
        {/* Restarting while a verification is in flight would be overridden by
            its own result: the request would authenticate and navigate into the
            portal, or overwrite a login the user has since restarted. */}
        <Button
          type="link"
          disabled={pending}
          onClick={() => {
            if (pending) {
              return;
            }
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
