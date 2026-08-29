import { useMutation } from "@tanstack/react-query";
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
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { IdempotencyKey } from "typespec/common/idempotency";
import { APIErrorAlert } from "./errors";
import { useIdempotencyKey } from "./idempotency";
import { usePendingOperations } from "./pending-operations";

interface ChangePasswordTranslations {
  title: string;
  description: string;
  success: string;
  action: string;
  newPassword: string;
  confirmPassword: string;
  passwordMismatch: string;
  invalidPassword: string;
  required: string;
}

export function ChangePasswordCard({
  changePassword,
  validPassword,
  isRecentAuthenticationRequired,
  reauthenticationAlert,
  problemKeys,
  fallbackProblemKey,
  translations,
}: {
  changePassword: (newPassword: string) => Promise<void>;
  validPassword: (password: string) => boolean;
  isRecentAuthenticationRequired: (error: unknown) => boolean;
  reauthenticationAlert: ReactNode;
  problemKeys: Readonly<Record<string, string>>;
  fallbackProblemKey: string;
  translations: ChangePasswordTranslations;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    new_password: string;
    confirm_password: string;
  }>();
  const mutation = useMutation({
    mutationFn: ({ new_password }: { new_password: string }) =>
      changePassword(new_password),
  });
  const submit = async (values: { new_password: string }) => {
    try {
      await mutation.mutateAsync(values);
      form.resetFields();
      void message.success(t(translations.success));
    } catch {
      // The shared problem alert presents the failure.
    }
  };
  return (
    <Card title={t(translations.title)}>
      <Space orientation="vertical" size="middle" className="full-width">
        <Typography.Text type="secondary">
          {t(translations.description)}
        </Typography.Text>
        {isRecentAuthenticationRequired(mutation.error) ? (
          reauthenticationAlert
        ) : (
          <APIErrorAlert
            error={mutation.error}
            problemKeys={problemKeys}
            fallbackKey={fallbackProblemKey}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          className="settings-form"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="new_password"
            label={t(translations.newPassword)}
            rules={[
              { required: true, message: t(translations.required) },
              {
                validator: (_, value: string | undefined) =>
                  value === undefined || value === "" || validPassword(value)
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(t(translations.invalidPassword)),
                      ),
              },
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={128} />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label={t(translations.confirmPassword)}
            dependencies={["new_password"]}
            rules={[
              { required: true, message: t(translations.required) },
              ({ getFieldValue }) => ({
                validator: (_, value: string | undefined) =>
                  value === undefined || value === getFieldValue("new_password")
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(t(translations.passwordMismatch)),
                      ),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={128} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            {t(translations.action)}
          </Button>
        </Form>
      </Space>
    </Card>
  );
}

export interface TOTPEnrollment {
  totp_enrollment_token: string;
  provisioning_uri: string;
  manual_entry_key: string;
  expires_at: string;
  configuration: {
    algorithm: string;
    digits: number;
    period_seconds: number;
  };
}

interface RecoveryCodesResponse {
  recovery_codes: string[];
}

export interface TwoFactorOperations {
  start: (key: IdempotencyKey) => Promise<TOTPEnrollment>;
  confirm: (
    enrollmentToken: string,
    code: string,
    key: IdempotencyKey,
  ) => Promise<RecoveryCodesResponse>;
  disable: () => Promise<void>;
  regenerate: (key: IdempotencyKey) => Promise<RecoveryCodesResponse>;
}

interface TwoFactorTranslations {
  title: string;
  description: string;
  status: string;
  statusEnabled: string;
  statusDisabled: string;
  disabled: string;
  recoveryCodes: string;
  regenerate: string;
  regenerateConfirm: string;
  regenerated: string;
  disable: string;
  disableConfirm: string;
  disableWarning: string;
  start: string;
  scan: string;
  qrLabel: string;
  manualKey: string;
  algorithm: string;
  digits: string;
  period: string;
  seconds: string;
  expires: string;
  totpCode: string;
  totpValidation: string;
  confirm: string;
  success: string;
  required: string;
  cancel: string;
  commonConfirm: string;
}

export function TwoFactorCard({
  totpEnabled,
  recoveryCodesRemaining,
  sessionToken,
  operations,
  refreshProfile,
  showRecoveryCodes,
  isRecentAuthenticationRequired,
  reauthenticationAlert,
  problemKeys,
  fallbackProblemKey,
  translations,
}: {
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
  sessionToken: string | null;
  operations: TwoFactorOperations;
  refreshProfile: () => void;
  showRecoveryCodes: (codes: string[], session: string) => void;
  isRecentAuthenticationRequired: (error: unknown) => boolean;
  reauthenticationAlert: ReactNode;
  problemKeys: Readonly<Record<string, string>>;
  fallbackProblemKey: string;
  translations: TwoFactorTranslations;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const { hold, pending } = usePendingOperations();
  const [enrollment, setEnrollment] = useState<TOTPEnrollment | null>(null);
  const startKey = useIdempotencyKey();
  const confirmKey = useIdempotencyKey();
  const regenerateKey = useIdempotencyKey();
  const startMutation = useMutation({
    mutationFn: () => operations.start(startKey.current()),
  });
  const confirmMutation = useMutation({
    mutationFn: (code: string) => {
      if (enrollment === null) throw new Error("Missing TOTP enrollment");
      return operations.confirm(
        enrollment.totp_enrollment_token,
        code,
        confirmKey.current(),
      );
    },
  });
  const disableMutation = useMutation({ mutationFn: operations.disable });
  const regenerateMutation = useMutation({
    mutationFn: () => operations.regenerate(regenerateKey.current()),
  });
  const busy = disableMutation.isPending || regenerateMutation.isPending;
  const errors = [
    startMutation.error,
    confirmMutation.error,
    disableMutation.error,
    regenerateMutation.error,
  ];
  const stepUpRequired = errors.some(isRecentAuthenticationRequired);
  const error = errors.find((candidate) => candidate !== null);
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
      refreshProfile();
      release();
    }
  };
  const confirm = async (code: string) => {
    if (sessionToken === null || enrollment === null || pending) return;
    const issuingSession = sessionToken;
    const release = hold();
    try {
      const response = await confirmMutation.mutateAsync(code);
      rotateAll();
      setEnrollment(null);
      showRecoveryCodes(response.recovery_codes, issuingSession);
      void message.success(t(translations.success));
    } catch {
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
      rotateAll();
      setEnrollment(null);
      void message.success(t(translations.disabled));
    } catch {
    } finally {
      refreshProfile();
      release();
    }
  };
  const regenerate = async () => {
    if (sessionToken === null || busy || pending) return;
    const issuingSession = sessionToken;
    const release = hold();
    try {
      const response = await regenerateMutation.mutateAsync();
      regenerateKey.rotate();
      showRecoveryCodes(response.recovery_codes, issuingSession);
      void message.success(t(translations.regenerated));
    } catch {
    } finally {
      refreshProfile();
      release();
    }
  };
  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <Card title={t(translations.title)}>
      <Space orientation="vertical" size="middle" className="full-width">
        <Typography.Text type="secondary">
          {t(translations.description)}
        </Typography.Text>
        <Descriptions
          column={1}
          items={[
            {
              key: "status",
              label: t(translations.status),
              children: (
                <Tag color={totpEnabled ? "green" : "default"}>
                  {totpEnabled
                    ? t(translations.statusEnabled)
                    : t(translations.statusDisabled)}
                </Tag>
              ),
            },
            ...(totpEnabled
              ? [
                  {
                    key: "codes",
                    label: t(translations.recoveryCodes),
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
          reauthenticationAlert
        ) : (
          <APIErrorAlert
            error={error}
            problemKeys={problemKeys}
            fallbackKey={fallbackProblemKey}
          />
        )}
        {totpEnabled ? (
          <Flex gap="small" wrap>
            <Popconfirm
              title={t(translations.regenerateConfirm)}
              okText={t(translations.commonConfirm)}
              cancelText={t(translations.cancel)}
              disabled={busy}
              onConfirm={() => void regenerate()}
            >
              <Button disabled={busy} loading={regenerateMutation.isPending}>
                {t(translations.regenerate)}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t(translations.disableConfirm)}
              description={t(translations.disableWarning)}
              okText={t(translations.commonConfirm)}
              cancelText={t(translations.cancel)}
              disabled={busy}
              onConfirm={() => void disable()}
            >
              <Button
                danger
                disabled={busy}
                loading={disableMutation.isPending}
              >
                {t(translations.disable)}
              </Button>
            </Popconfirm>
          </Flex>
        ) : enrollment === null ? (
          <Button
            type="primary"
            loading={startMutation.isPending}
            onClick={() => void start()}
          >
            {t(translations.start)}
          </Button>
        ) : (
          <Space orientation="vertical" size="middle" className="full-width">
            <Typography.Text>{t(translations.scan)}</Typography.Text>
            <QRCode
              value={enrollment.provisioning_uri}
              aria-label={t(translations.qrLabel)}
            />
            <Descriptions
              column={1}
              items={[
                {
                  key: "manual",
                  label: t(translations.manualKey),
                  children: (
                    <Typography.Text code copyable>
                      {enrollment.manual_entry_key}
                    </Typography.Text>
                  ),
                },
                {
                  key: "algorithm",
                  label: t(translations.algorithm),
                  children: enrollment.configuration.algorithm,
                },
                {
                  key: "digits",
                  label: t(translations.digits),
                  children: enrollment.configuration.digits,
                },
                {
                  key: "period",
                  label: t(translations.period),
                  children: t(translations.seconds, {
                    seconds: enrollment.configuration.period_seconds,
                  }),
                },
                {
                  key: "expires",
                  label: t(translations.expires),
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
                label={t(translations.totpCode)}
                rules={[
                  { required: true, message: t(translations.required) },
                  {
                    pattern: /^\d{6}$/,
                    message: t(translations.totpValidation),
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
                  loading={confirmMutation.isPending}
                >
                  {t(translations.confirm)}
                </Button>
                <Button
                  disabled={confirmMutation.isPending}
                  onClick={() => setEnrollment(null)}
                >
                  {t(translations.cancel)}
                </Button>
              </Flex>
            </Form>
          </Space>
        )}
      </Space>
    </Card>
  );
}
