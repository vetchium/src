import { useMutation } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import { ReauthenticationAlert } from "@vetchium/portal-ui/shell";
import {
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  Popconfirm,
  QRCode,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isTOTPCode } from "typespec/common/authentication";
import type { StartTOTPEnrollmentResponse } from "typespec/orgs/auth/totp";
import {
  TOTPAlreadyEnabledError,
  TOTPNotEnabledError,
} from "typespec/problem/orgs/totp";
import {
  getProblemType,
  isDefiniteRefusal,
  isRecentAuthenticationRequired,
} from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { useAuth } from "../../auth/AuthContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../../components/common/useDateTimeFormat";
import { useRecoveryCodes } from "./RecoveryCodesContext";

/**
 * The Org session endpoint does not report whether TOTP is enabled, so the
 * card starts with that unknown and learns it from the outcome of each action
 * taken here: an enrollment or a refusal naming the current state.
 */
export function TwoFactorCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const formatDateTime = useDateTimeFormat();
  const { sessionToken } = useAuth();
  const { show: showRecoveryCodes } = useRecoveryCodes();
  const { hold, pending } = usePendingOperations();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrollment, setEnrollment] =
    useState<StartTOTPEnrollmentResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const startKey = useIdempotencyKey();
  const confirmKey = useIdempotencyKey();
  const regenerateKey = useIdempotencyKey();
  const start = useMutation({
    mutationFn: () => orgsAPI.startTOTPEnrollment(startKey.current()),
  });
  const confirm = useMutation({
    mutationFn: ({ token, code }: { token: string; code: string }) =>
      orgsAPI.confirmTOTPEnrollment(
        { totp_enrollment_token: token, totp_code: code },
        confirmKey.current(),
      ),
  });
  const disable = useMutation({ mutationFn: orgsAPI.disableTOTP });
  const regenerate = useMutation({
    mutationFn: () => orgsAPI.regenerateRecoveryCodes(regenerateKey.current()),
  });
  const busy =
    start.isPending ||
    confirm.isPending ||
    disable.isPending ||
    regenerate.isPending;

  const learnState = (failure: unknown) => {
    const type = getProblemType(failure);
    if (type === TOTPAlreadyEnabledError.type) setEnabled(true);
    if (type === TOTPNotEnabledError.type) setEnabled(false);
  };
  const run = async (action: () => Promise<void>) => {
    if (busy || pending) return;
    setError(null);
    const release = hold();
    try {
      await action();
    } catch (failure) {
      // A refused attempt is finished; the next one is a new request.
      if (isDefiniteRefusal(failure)) {
        startKey.rotate();
        confirmKey.rotate();
        regenerateKey.rotate();
      }
      learnState(failure);
      setError(failure);
    } finally {
      release();
    }
  };

  const startEnrollment = () =>
    run(async () => {
      const response = await start.mutateAsync();
      startKey.rotate();
      setEnrollment(response);
    });
  const confirmEnrollment = (code: string) =>
    run(async () => {
      if (enrollment === null || sessionToken === null) return;
      const issuingSession = sessionToken;
      const response = await confirm.mutateAsync({
        token: enrollment.totp_enrollment_token,
        code,
      });
      confirmKey.rotate();
      startKey.rotate();
      setEnrollment(null);
      setEnabled(true);
      showRecoveryCodes(response.recovery_codes, issuingSession);
      void message.success(t("security.twoFactor.enabled"));
    });
  const disableTOTP = () =>
    run(async () => {
      await disable.mutateAsync();
      setEnabled(false);
      void message.success(t("security.twoFactor.disabled"));
    });
  const regenerateCodes = () =>
    run(async () => {
      if (sessionToken === null) return;
      const issuingSession = sessionToken;
      const response = await regenerate.mutateAsync();
      regenerateKey.rotate();
      setEnabled(true);
      showRecoveryCodes(response.recovery_codes, issuingSession);
      void message.success(t("security.recoveryCodes.regenerated"));
    });

  return (
    <Card title={t("security.twoFactor.title")} data-testid="two-factor-card">
      <Flex orientation="vertical" gap="middle">
        <Typography.Text type="secondary">
          {t("security.twoFactor.description")}
        </Typography.Text>
        {enabled === null ? null : (
          <div>
            <Tag
              color={enabled ? "green" : "default"}
              data-testid="two-factor-status"
              data-enabled={enabled}
            >
              {enabled
                ? t("security.twoFactor.statusEnabled")
                : t("security.twoFactor.statusDisabled")}
            </Tag>
          </div>
        )}
        {isRecentAuthenticationRequired(error) ? (
          <ReauthenticationAlert />
        ) : (
          <APIErrorAlert error={error} />
        )}
        {enrollment === null ? (
          <Flex gap="small" wrap>
            {enabled === true ? null : (
              <Button
                type="primary"
                loading={start.isPending}
                disabled={busy}
                onClick={() => void startEnrollment()}
              >
                {t("security.twoFactor.start")}
              </Button>
            )}
            {enabled === false ? null : (
              <>
                <Popconfirm
                  title={t("security.recoveryCodes.regenerateConfirm")}
                  okText={t("common.confirm")}
                  cancelText={t("common.cancel")}
                  disabled={busy}
                  onConfirm={() => void regenerateCodes()}
                >
                  <Button disabled={busy} loading={regenerate.isPending}>
                    {t("security.recoveryCodes.regenerate")}
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title={t("security.twoFactor.disableConfirm")}
                  description={t("security.twoFactor.disableWarning")}
                  okText={t("common.confirm")}
                  cancelText={t("common.cancel")}
                  disabled={busy}
                  onConfirm={() => void disableTOTP()}
                >
                  <Button danger disabled={busy} loading={disable.isPending}>
                    {t("security.twoFactor.disable")}
                  </Button>
                </Popconfirm>
              </>
            )}
          </Flex>
        ) : (
          <Flex orientation="vertical" gap="middle">
            <Typography.Text>{t("security.twoFactor.scan")}</Typography.Text>
            <QRCode
              value={enrollment.provisioning_uri}
              aria-label={t("security.twoFactor.qrLabel")}
            />
            <Descriptions
              column={1}
              items={[
                {
                  key: "manual",
                  label: t("security.twoFactor.manualKey"),
                  children: (
                    <Typography.Text
                      code
                      copyable
                      data-testid="totp-manual-key"
                    >
                      {enrollment.manual_entry_key}
                    </Typography.Text>
                  ),
                },
                {
                  key: "algorithm",
                  label: t("security.twoFactor.algorithm"),
                  children: enrollment.configuration.algorithm,
                },
                {
                  key: "digits",
                  label: t("security.twoFactor.digits"),
                  children: enrollment.configuration.digits,
                },
                {
                  key: "period",
                  label: t("security.twoFactor.period"),
                  children: t("security.twoFactor.seconds", {
                    seconds: enrollment.configuration.period_seconds,
                  }),
                },
                {
                  key: "expires",
                  label: t("security.twoFactor.expires"),
                  children: formatDateTime(enrollment.expires_at),
                },
              ]}
            />
            <Form<{ totp_code: string }>
              layout="vertical"
              onFinish={({ totp_code }) => void confirmEnrollment(totp_code)}
            >
              <Form.Item
                name="totp_code"
                label={t("fields.totpCode")}
                rules={[
                  { required: true, message: t("validation.required") },
                  {
                    validator: (_, value: string | undefined) =>
                      value === undefined || value === "" || isTOTPCode(value)
                        ? Promise.resolve()
                        : Promise.reject(new Error(t("validation.totpCode"))),
                  },
                ]}
              >
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                />
              </Form.Item>
              <Flex gap="small" wrap>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={confirm.isPending}
                >
                  {t("security.twoFactor.confirm")}
                </Button>
                <Button
                  disabled={confirm.isPending}
                  onClick={() => {
                    setEnrollment(null);
                    setError(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </Flex>
            </Form>
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
