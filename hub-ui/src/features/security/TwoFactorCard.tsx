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
import type { StartTOTPEnrollmentResponse } from "../../../../typespec/hub/auth/totp.ts";
import { isRecentAuthenticationRequired } from "../../api/client";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { useAuth } from "../../auth/AuthContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";
import { useRecoveryCodes } from "./RecoveryCodesContext";

export function TwoFactorCard({
  totpEnabled,
  recoveryCodesRemaining,
}: {
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { show } = useRecoveryCodes();
  const { hold, pending } = usePendingOperations();
  const [enrollment, setEnrollment] =
    useState<StartTOTPEnrollmentResponse | null>(null);
  const startKey = useIdempotencyKey();
  const confirmKey = useIdempotencyKey();
  const regenerateKey = useIdempotencyKey();
  const startMutation = useMutation({
    mutationFn: () => hubAPI.startTOTPEnrollment(startKey.current()),
  });
  const confirmMutation = useMutation({
    mutationFn: (totp_code: string) => {
      if (enrollment === null) throw new Error("Missing TOTP enrollment");
      return hubAPI.confirmTOTPEnrollment(
        { totp_enrollment_token: enrollment.totp_enrollment_token, totp_code },
        confirmKey.current(),
      );
    },
  });
  const disableMutation = useMutation({ mutationFn: hubAPI.disableTOTP });
  const regenerateMutation = useMutation({
    mutationFn: () => hubAPI.regenerateRecoveryCodes(regenerateKey.current()),
  });
  const busy = disableMutation.isPending || regenerateMutation.isPending;
  const stepUpRequired = [
    startMutation.error,
    disableMutation.error,
    regenerateMutation.error,
  ].some(isRecentAuthenticationRequired);
  const error =
    startMutation.error ??
    confirmMutation.error ??
    disableMutation.error ??
    regenerateMutation.error;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
  const rotateAll = () => {
    startKey.rotate();
    confirmKey.rotate();
    regenerateKey.rotate();
  };

  const start = async () => {
    if (pending) return;
    const release = hold();
    try {
      setEnrollment(await startMutation.mutateAsync());
      startKey.rotate();
    } catch {
    } finally {
      refresh();
      release();
    }
  };
  const confirm = async (totp_code: string) => {
    const issuingSession = session?.session_token;
    if (issuingSession === undefined || enrollment === null || pending) return;
    const release = hold();
    try {
      const response = await confirmMutation.mutateAsync(totp_code);
      rotateAll();
      setEnrollment(null);
      show(response.recovery_codes, issuingSession);
      void message.success(t("tfa.enabled"));
    } catch {
    } finally {
      refresh();
      release();
    }
  };
  const disable = async () => {
    if (busy || pending) return;
    const release = hold();
    try {
      await disableMutation.mutateAsync();
      rotateAll();
      setEnrollment(null);
      void message.success(t("tfa.disabled"));
    } catch {
    } finally {
      refresh();
      release();
    }
  };
  const regenerate = async () => {
    const issuingSession = session?.session_token;
    if (issuingSession === undefined || busy || pending) return;
    const release = hold();
    try {
      const response = await regenerateMutation.mutateAsync();
      regenerateKey.rotate();
      show(response.recovery_codes, issuingSession);
      void message.success(t("tfa.regenerated"));
    } catch {
    } finally {
      refresh();
      release();
    }
  };
  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Card title={t("tfa.title")}>
      <Space orientation="vertical" size="middle" className="full-width">
        <Typography.Text type="secondary">
          {t("tfa.description")}
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
                    key: "codes",
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
        {stepUpRequired ? (
          <ReauthenticationAlert />
        ) : (
          <APIErrorAlert error={error} />
        )}
        {totpEnabled ? (
          <Flex gap="small" wrap>
            <Popconfirm
              title={t("tfa.regenerateConfirm")}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
              disabled={busy}
              onConfirm={() => void regenerate()}
            >
              <Button disabled={busy} loading={regenerateMutation.isPending}>
                {t("tfa.regenerate")}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t("tfa.disableConfirm")}
              description={t("tfa.disableWarning")}
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
                {t("tfa.disable")}
              </Button>
            </Popconfirm>
          </Flex>
        ) : enrollment === null ? (
          <Button
            type="primary"
            loading={startMutation.isPending}
            onClick={() => void start()}
          >
            {t("tfa.enable")}
          </Button>
        ) : (
          <Space orientation="vertical" size="middle" className="full-width">
            <Typography.Text>{t("tfa.enrollmentInstructions")}</Typography.Text>
            <QRCode
              value={enrollment.provisioning_uri}
              aria-label={t("tfa.qrLabel")}
            />
            <Descriptions
              column={1}
              items={[
                {
                  key: "manual",
                  label: t("tfa.manualKey"),
                  children: (
                    <Typography.Text code copyable>
                      {enrollment.manual_entry_key}
                    </Typography.Text>
                  ),
                },
                {
                  key: "algorithm",
                  label: t("tfa.algorithm"),
                  children: enrollment.configuration.algorithm,
                },
                {
                  key: "digits",
                  label: t("tfa.digits"),
                  children: enrollment.configuration.digits,
                },
                {
                  key: "period",
                  label: t("tfa.period"),
                  children: t("tfa.seconds", {
                    seconds: enrollment.configuration.period_seconds,
                  }),
                },
                {
                  key: "expires",
                  label: t("tfa.expires"),
                  children: dateTime.format(new Date(enrollment.expires_at)),
                },
              ]}
            />
            <Form<{ totp_code: string }>
              layout="vertical"
              onFinish={({ totp_code }) => void confirm(totp_code)}
            >
              <Form.Item
                name="totp_code"
                label={t("fields.totpCode")}
                rules={[
                  { required: true, message: t("validation.required") },
                  { pattern: /^\d{6}$/, message: t("validation.totp") },
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
                  {t("tfa.confirm")}
                </Button>
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
