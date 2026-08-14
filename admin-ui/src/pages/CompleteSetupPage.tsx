import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type {
  LanguageCode,
  TimeZoneID,
} from "../../../typespec/common/localization.ts";
import { completeSetup } from "../features/auth/api";
import { useCompanyRegionalDefaultsQuery } from "../features/company/queries";

interface SetupForm {
  password: string;
  confirm_password: string;
  display_name: string;
  language: LanguageCode;
  timezone: TimeZoneID;
}

export function CompleteSetupPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const defaults = useCompanyRegionalDefaultsQuery();
  const mutation = useMutation({ mutationFn: completeSetup });
  const [form] = Form.useForm<SetupForm>();
  const languageOptions = ["en-US", "de-DE", "ta-IN"].map((value) => ({
    value,
    label: t(`languages.${value}`),
  }));

  useEffect(() => {
    if (
      defaults.data === undefined ||
      form.isFieldsTouched(["language", "timezone"])
    ) {
      return;
    }
    form.setFieldsValue({
      language: defaults.data.default_language,
      timezone: defaults.data.default_timezone,
    });
  }, [defaults.data, form]);

  const submit = (values: SetupForm) => {
    if (token === null) return;
    mutation.mutate({
      invitation_token: token,
      password: values.password,
      display_names: [
        { language_code: values.language, display_name: values.display_name },
      ],
      primary_display_name_language: values.language,
      preferred_language: values.language,
      preferred_timezone: values.timezone,
    });
  };

  return (
    <Card className="auth-card setup-card">
      <title>{t("completeSetup.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={2}>
            {t("completeSetup.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("completeSetup.description")}
          </Typography.Text>
        </div>
        {token === null ? (
          <Alert type="error" title={t("completeSetup.missingToken")} />
        ) : null}
        {mutation.isSuccess ? (
          <Alert type="success" title={t("completeSetup.success")} />
        ) : null}
        {mutation.isError ? (
          <Alert type="error" title={t("completeSetup.error")} />
        ) : null}
        {!mutation.isSuccess && token !== null ? (
          <Form<SetupForm>
            form={form}
            layout="vertical"
            onFinish={submit}
            initialValues={{
              language: defaults.data?.default_language ?? "en-US",
              timezone: defaults.data?.default_timezone ?? "Asia/Kolkata",
            }}
          >
            <Form.Item
              name="display_name"
              label={t("fields.displayName")}
              rules={[{ required: true, message: t("validation.required") }]}
            >
              <Input autoComplete="name" maxLength={200} />
            </Form.Item>
            <Form.Item
              name="language"
              label={t("fields.language")}
              rules={[{ required: true }]}
            >
              <Select options={languageOptions} />
            </Form.Item>
            <Form.Item
              name="timezone"
              label={t("fields.timezone")}
              rules={[{ required: true, message: t("validation.required") }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="password"
              label={t("fields.password")}
              rules={[
                {
                  required: true,
                  min: 15,
                  message: t("validation.newPassword"),
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
                  validator: (_, value: string) =>
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
              loading={mutation.isPending}
            >
              {t("completeSetup.action")}
            </Button>
          </Form>
        ) : null}
        {mutation.isSuccess ? (
          <Link to="/login">{t("completeSetup.signIn")}</Link>
        ) : null}
      </Space>
    </Card>
  );
}
