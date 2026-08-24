import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Divider,
  Flex,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isNewPassword } from "../../../typespec/common/authentication.ts";
import {
  countryCodeValues,
  type FrontendLocale,
} from "../../../typespec/common/localization.ts";
import type { StartTOTPEnrollmentResponse } from "../../../typespec/hub/auth/totp.ts";
import { hubAPI } from "../api/hub";
import { usePreferences } from "../app/PreferencesContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

const languages: FrontendLocale[] = ["en-US", "ta", "de-DE"];

interface ChangePasswordValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const auth = useAuth();
  const [enrollment, setEnrollment] =
    useState<StartTOTPEnrollmentResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const info = useQuery({ queryKey: ["hub-my-info"], queryFn: hubAPI.myInfo });

  const updateLanguage = useMutation({
    mutationFn: (preferred_language: FrontendLocale) =>
      hubAPI.setPreferredLanguage({ preferred_language }),
    onSuccess: (_, preferredLanguage) => {
      preferences.setLanguage(preferredLanguage);
      auth.updateSession({ preferred_language: preferredLanguage });
      void queryClient.invalidateQueries({ queryKey: ["hub-my-info"] });
      void message.success(t("settings.saved"));
    },
  });
  const updateCountry = useMutation({
    mutationFn: (resident_country: string) =>
      hubAPI.setResidentCountry({ resident_country }),
    onSuccess: (_, residentCountry) => {
      auth.updateSession({ resident_country: residentCountry });
      void queryClient.invalidateQueries({ queryKey: ["hub-my-info"] });
      void message.success(t("settings.saved"));
    },
  });
  const changePassword = useMutation({
    mutationFn: async (values: ChangePasswordValues) => {
      await hubAPI.reauthenticate({ password: values.current_password });
      await hubAPI.changePassword({ new_password: values.new_password });
    },
    onSuccess: () => void message.success(t("passwordChange.success")),
  });
  const startTOTP = useMutation({
    mutationFn: async (password: string) => {
      await hubAPI.reauthenticate({ password });
      return hubAPI.startTOTPEnrollment();
    },
    onSuccess: setEnrollment,
  });
  const confirmTOTP = useMutation({
    mutationFn: (totp_code: string) => {
      if (enrollment === null) throw new Error("Missing TOTP enrollment");
      return hubAPI.confirmTOTPEnrollment({
        totp_enrollment_token: enrollment.totp_enrollment_token,
        totp_code,
      });
    },
    onSuccess: (response) => {
      setRecoveryCodes(response.recovery_codes);
      setEnrollment(null);
      void queryClient.invalidateQueries({ queryKey: ["hub-my-info"] });
    },
  });
  const disableTOTP = useMutation({
    mutationFn: async (password: string) => {
      await hubAPI.reauthenticate({ password });
      await hubAPI.disableTOTP();
    },
    onSuccess: () => {
      setRecoveryCodes(null);
      void queryClient.invalidateQueries({ queryKey: ["hub-my-info"] });
      void message.success(t("tfa.disabled"));
    },
  });
  const regenerateCodes = useMutation({
    mutationFn: async (password: string) => {
      await hubAPI.reauthenticate({ password });
      return hubAPI.regenerateRecoveryCodes();
    },
    onSuccess: (response) => {
      setRecoveryCodes(response.recovery_codes);
      void queryClient.invalidateQueries({ queryKey: ["hub-my-info"] });
    },
  });

  if (info.isPending) return <Spin size="large" />;
  if (info.isError) return <APIErrorAlert error={info.error} />;

  return (
    <Flex component="main" orientation="vertical" gap="large">
      <title>{t("settings.documentTitle")}</title>
      <Typography.Title level={1}>{t("settings.title")}</Typography.Title>
      <Card title={t("profile.title")}>
        <Space orientation="vertical" size="large" className="full-width">
          <Descriptions
            column={{ xs: 1, sm: 2 }}
            items={[
              {
                key: "name",
                label: t("fields.displayName"),
                children: info.data.display_name,
              },
              {
                key: "email",
                label: t("fields.email"),
                children: info.data.email_address,
              },
              {
                key: "handle",
                label: t("fields.handle"),
                children: info.data.handle,
              },
              {
                key: "did",
                label: t("fields.did"),
                children: info.data.hub_user_did,
              },
            ]}
          />
          <Flex gap="middle" wrap>
            <Space orientation="vertical">
              <Typography.Text>{t("fields.language")}</Typography.Text>
              <Select<FrontendLocale>
                value={info.data.preferred_language}
                loading={updateLanguage.isPending}
                style={{ minWidth: 220 }}
                options={languages.map((language) => ({
                  value: language,
                  label: t(`languages.${language}`),
                }))}
                onChange={(language) => updateLanguage.mutate(language)}
              />
            </Space>
            <Space orientation="vertical">
              <Typography.Text>{t("fields.residentCountry")}</Typography.Text>
              <Select
                showSearch
                optionFilterProp="label"
                value={info.data.resident_country}
                loading={updateCountry.isPending}
                style={{ minWidth: 220 }}
                options={countryCodeValues.map((country) => ({
                  value: country,
                  label: country,
                }))}
                onChange={(country) => updateCountry.mutate(country)}
              />
            </Space>
          </Flex>
          <APIErrorAlert error={updateLanguage.error ?? updateCountry.error} />
        </Space>
      </Card>
      <Card title={t("passwordChange.title")}>
        <Typography.Paragraph type="secondary">
          {t("passwordChange.description")}
        </Typography.Paragraph>
        <APIErrorAlert error={changePassword.error} />
        <Form<ChangePasswordValues>
          layout="vertical"
          className="settings-form"
          onFinish={(values) => changePassword.mutate(values)}
        >
          <Form.Item
            name="current_password"
            label={t("fields.currentPassword")}
            rules={[{ required: true, message: t("validation.required") }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label={t("fields.newPassword")}
            rules={[
              { required: true, message: t("validation.required") },
              {
                validator: (_, value) =>
                  isNewPassword(value ?? "")
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.newPassword"))),
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
                    : Promise.reject(new Error(t("validation.passwordMatch"))),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={changePassword.isPending}
          >
            {t("passwordChange.action")}
          </Button>
        </Form>
      </Card>
      <Card title={t("tfa.title")}>
        <Typography.Paragraph type="secondary">
          {t("tfa.description")}
        </Typography.Paragraph>
        <APIErrorAlert
          error={
            startTOTP.error ??
            confirmTOTP.error ??
            disableTOTP.error ??
            regenerateCodes.error
          }
        />
        {recoveryCodes ? (
          <Space orientation="vertical" className="full-width">
            <Alert type="warning" showIcon title={t("tfa.saveRecoveryCodes")} />
            <Flex orientation="vertical">
              {recoveryCodes.map((code) => (
                <Typography.Text key={code} code copyable>
                  {code}
                </Typography.Text>
              ))}
            </Flex>
          </Space>
        ) : null}
        {enrollment ? (
          <Space orientation="vertical" className="full-width">
            <Alert
              type="info"
              showIcon
              title={t("tfa.enrollmentInstructions")}
            />
            <Typography.Text code copyable>
              {enrollment.manual_entry_key}
            </Typography.Text>
            <Form<{ totp_code: string }>
              layout="vertical"
              className="settings-form"
              onFinish={({ totp_code }) => confirmTOTP.mutate(totp_code)}
            >
              <Form.Item
                name="totp_code"
                label={t("fields.totpCode")}
                rules={[
                  {
                    required: true,
                    pattern: /^[0-9]{6}$/,
                    message: t("validation.totp"),
                  },
                ]}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={confirmTOTP.isPending}
              >
                {t("tfa.confirm")}
              </Button>
            </Form>
          </Space>
        ) : info.data.totp_enabled ? (
          <Flex gap="large" wrap>
            <RecentPasswordAction
              actionLabel={t("tfa.regenerate")}
              loading={regenerateCodes.isPending}
              onSubmit={(password) => regenerateCodes.mutate(password)}
            />
            <RecentPasswordAction
              actionLabel={t("tfa.disable")}
              danger
              loading={disableTOTP.isPending}
              onSubmit={(password) => disableTOTP.mutate(password)}
            />
          </Flex>
        ) : (
          <RecentPasswordAction
            actionLabel={t("tfa.enable")}
            loading={startTOTP.isPending}
            onSubmit={(password) => startTOTP.mutate(password)}
          />
        )}
        <Divider />
        <Typography.Text type="secondary">
          {t("tfa.remaining", { count: info.data.recovery_codes_remaining })}
        </Typography.Text>
      </Card>
    </Flex>
  );
}

function RecentPasswordAction({
  actionLabel,
  danger = false,
  loading,
  onSubmit,
}: {
  actionLabel: string;
  danger?: boolean;
  loading: boolean;
  onSubmit: (password: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Form<{ password: string }>
      layout="vertical"
      className="settings-form"
      onFinish={({ password }) => onSubmit(password)}
    >
      <Form.Item
        name="password"
        label={t("fields.currentPassword")}
        rules={[{ required: true, message: t("validation.required") }]}
      >
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Button
        danger={danger}
        type={danger ? "default" : "primary"}
        htmlType="submit"
        loading={loading}
      >
        {actionLabel}
      </Button>
    </Form>
  );
}
