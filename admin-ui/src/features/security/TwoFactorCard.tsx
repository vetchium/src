import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  Space,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConfirmTOTPEnrollmentRequest,
  StartTOTPEnrollmentResponse,
} from "../../../../typespec/admin/auth/totp.ts";
import type {
  TOTPCode,
  TOTPRecoveryCodeCount,
} from "../../../../typespec/common/authentication.ts";
import { IncorrectTOTPCodeError } from "../../../../typespec/problem/admin/authentication.ts";
import {
  InvalidTOTPEnrollmentError,
  TOTPAlreadyEnabledError,
  TOTPNotEnabledError,
} from "../../../../typespec/problem/admin/totp.ts";
import { isRecentAuthenticationRequired } from "../../api/client";
import { useIdempotencyKey } from "../../api/idempotency";
import { problemTranslationKey } from "../../api/problems";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { intlLocale } from "../../app/preferences";
import { useAuth } from "../../auth/AuthContext";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";
import {
  confirmTOTPEnrollment,
  disableTOTP,
  regenerateTOTPRecoveryCodes,
  startTOTPEnrollment,
} from "./api";
import { useRecoveryCodes } from "./RecoveryCodesContext";

interface TwoFactorCardProps {
  totpEnabled: boolean;
  recoveryCodesRemaining: TOTPRecoveryCodeCount;
}

interface ConfirmForm {
  totp_code: TOTPCode;
}

const startProblems = {
  [TOTPAlreadyEnabledError.type]: "security.twoFactor.errors.alreadyEnabled",
};

const confirmProblems = {
  [IncorrectTOTPCodeError.type]: "security.twoFactor.errors.incorrectCode",
  [InvalidTOTPEnrollmentError.type]:
    "security.twoFactor.errors.invalidEnrollment",
};

const regenerateProblems = {
  [TOTPNotEnabledError.type]: "security.twoFactor.errors.notEnabled",
};

export function TwoFactorCard({
  totpEnabled,
  recoveryCodesRemaining,
}: TwoFactorCardProps) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] =
    useState<StartTOTPEnrollmentResponse | null>(null);
  const { show: showRecoveryCodes } = useRecoveryCodes();
  const { sessionToken } = useAuth();
  const startKey = useIdempotencyKey();
  const confirmKey = useIdempotencyKey();
  const regenerateKey = useIdempotencyKey();
  const startMutation = useMutation({
    mutationFn: () => startTOTPEnrollment(startKey.current()),
  });
  const confirmMutation = useMutation({
    mutationFn: (request: ConfirmTOTPEnrollmentRequest) =>
      confirmTOTPEnrollment(request, confirmKey.current()),
  });
  const disableMutation = useMutation({ mutationFn: disableTOTP });
  const regenerateMutation = useMutation({
    mutationFn: () => regenerateTOTPRecoveryCodes(regenerateKey.current()),
  });

  const dateTime = new Intl.DateTimeFormat(intlLocale(i18n.language), {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const stepUpRequired = [
    startMutation.error,
    disableMutation.error,
    regenerateMutation.error,
  ].some(isRecentAuthenticationRequired);
  // Regenerating and disabling contradict each other: codes committed by one
  // are void the moment the other lands, and the response order decides which
  // the user is shown. Neither may start while the other is in flight.
  const busy = disableMutation.isPending || regenerateMutation.isPending;
  // The hold belongs to the request, not to this card: leaving the security
  // page must not release it, because signing out or reloading before the
  // response lands still destroys a set of codes the server will not repeat.
  const { hold, pending } = usePendingOperations();

  // Disabling or re-enrolling voids every code the outstanding keys could
  // still replay, so those operations are finished with.
  const startFreshKeys = () => {
    startKey.rotate();
    confirmKey.rotate();
    regenerateKey.rotate();
  };

  // Refetched after every one of these operations, successful or not. A
  // confirmation that commits and then loses its response leaves the cached
  // profile saying two-factor is off, which hides the regenerate control that
  // is the recovery path out of exactly that situation.
  const refreshProfile = () => {
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
  };

  const reportFailure = (
    error: unknown,
    problems: Readonly<Record<string, string>> = {},
  ) => {
    if (!isRecentAuthenticationRequired(error)) {
      void message.error(t(problemTranslationKey(error, problems)));
    }
  };

  const start = async () => {
    if (pending) return;
    const release = hold();
    try {
      setEnrollment(await startMutation.mutateAsync());
      startKey.rotate();
    } catch (error) {
      reportFailure(error, startProblems);
    } finally {
      refreshProfile();
      release();
    }
  };

  const confirm = async ({ totp_code }: ConfirmForm) => {
    if (enrollment === null || sessionToken === null || pending) return;
    // Captured now: these codes belong to the session that asked for them, and
    // to no session that happens to hold the portal when they arrive.
    const issuingSession = sessionToken;
    const release = hold();
    try {
      const response = await confirmMutation.mutateAsync({
        totp_enrollment_token: enrollment.totp_enrollment_token,
        totp_code,
      });
      startFreshKeys();
      setEnrollment(null);
      showRecoveryCodes(response.recovery_codes, issuingSession);
      void message.success(t("security.twoFactor.enabled"));
    } catch (error) {
      reportFailure(error, confirmProblems);
    } finally {
      refreshProfile();
      release();
    }
  };

  const disable = async () => {
    if (busy || pending) return;
    const release = hold();
    try {
      await disableMutation.mutateAsync();
      startFreshKeys();
      setEnrollment(null);
      void message.success(t("security.twoFactor.disabled"));
    } catch (error) {
      reportFailure(error);
    } finally {
      refreshProfile();
      release();
    }
  };

  const regenerate = async () => {
    if (busy || sessionToken === null || pending) return;
    const issuingSession = sessionToken;
    const release = hold();
    try {
      const response = await regenerateMutation.mutateAsync();
      regenerateKey.rotate();
      showRecoveryCodes(response.recovery_codes, issuingSession);
      void message.success(t("security.recoveryCodes.regenerated"));
    } catch (error) {
      reportFailure(error, regenerateProblems);
    } finally {
      refreshProfile();
      release();
    }
  };

  return (
    <Card title={t("security.twoFactor.card")}>
      <Space orientation="vertical" size="middle" className="full-width">
        <Typography.Text type="secondary">
          {t("security.twoFactor.description")}
        </Typography.Text>
        <Descriptions
          column={1}
          items={[
            {
              key: "status",
              label: t("fields.twoFactor"),
              children: (
                <Tag color={totpEnabled ? "green" : "default"}>
                  {totpEnabled ? t("common.enabled") : t("common.disabled")}
                </Tag>
              ),
            },
            ...(totpEnabled
              ? [
                  {
                    key: "recoveryCodes",
                    label: t("fields.recoveryCodes"),
                    children: (
                      <span data-testid="recovery-codes-remaining">
                        {recoveryCodesRemaining}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {stepUpRequired ? <ReauthenticationAlert /> : null}
        {totpEnabled ? (
          <Flex gap="small" wrap>
            <Popconfirm
              title={t("security.recoveryCodes.regenerateConfirm")}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
              disabled={busy}
              onConfirm={() => void regenerate()}
            >
              <Button disabled={busy} loading={regenerateMutation.isPending}>
                {t("security.recoveryCodes.regenerate")}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t("security.twoFactor.disableConfirm")}
              description={t("security.twoFactor.disableWarning")}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
              disabled={busy}
              onConfirm={() => void disable()}
            >
              <Button
                danger
                disabled={busy}
                loading={disableMutation.isPending}
              >
                {t("security.twoFactor.disable")}
              </Button>
            </Popconfirm>
          </Flex>
        ) : enrollment === null ? (
          <Flex>
            <Button
              type="primary"
              loading={startMutation.isPending}
              onClick={() => void start()}
            >
              {t("security.twoFactor.start")}
            </Button>
          </Flex>
        ) : (
          <Space orientation="vertical" size="middle" className="full-width">
            <Typography.Text>{t("security.twoFactor.scan")}</Typography.Text>
            <Flex>
              <QRCode
                value={enrollment.provisioning_uri}
                aria-label={t("security.twoFactor.qrLabel")}
              />
            </Flex>
            <Descriptions
              column={1}
              items={[
                {
                  key: "manualKey",
                  label: t("security.twoFactor.manualKey"),
                  children: (
                    <Typography.Text code copyable>
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
                  label: t("security.twoFactor.enrollmentExpires"),
                  children: dateTime.format(new Date(enrollment.expires_at)),
                },
              ]}
            />
            <Form<ConfirmForm>
              layout="vertical"
              onFinish={(values) => void confirm(values)}
            >
              <Form.Item
                name="totp_code"
                label={t("fields.totpCode")}
                rules={[
                  { required: true, message: t("validation.required") },
                  { pattern: /^\d{6}$/, message: t("validation.totpCode") },
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
                  loading={confirmMutation.isPending}
                >
                  {t("security.twoFactor.confirm")}
                </Button>
                {/* Abandoning the panel mid-confirmation would hide the setup
                    while the request that enables it is still in flight. */}
                <Button
                  disabled={confirmMutation.isPending}
                  onClick={() => setEnrollment(null)}
                >
                  {t("common.cancel")}
                </Button>
              </Flex>
            </Form>
          </Space>
        )}
      </Space>
    </Card>
  );
}
