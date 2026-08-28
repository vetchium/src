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
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { FrontendLocale } from "../../../typespec/common/localization.ts";
import { countryCodeValues } from "../../../typespec/common/localization.ts";
import { hubAPI } from "../api/hub";
import { useIdempotencyKey } from "../api/idempotency";
import { usePreferences } from "../app/PreferencesContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";

const languages: FrontendLocale[] = ["en-US", "ta", "de-DE"];

interface SignupValues {
  display_name: string;
  email_address: string;
  preferred_language: FrontendLocale;
  resident_country: string;
}

export function SignupPage() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const key = useIdempotencyKey();
  const signup = useMutation({
    mutationFn: (request: SignupValues) =>
      hubAPI.requestSignup(request, key.current()),
    onSuccess: () => key.rotate(),
  });

  return (
    <Card className="auth-card">
      <title>{t("signup.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={1}>{t("signup.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("signup.description")}
          </Typography.Text>
        </div>
        {signup.isSuccess ? (
          <>
            <Alert type="success" showIcon title={t("signup.checkEmail")} />
            <Link to="/login">{t("common.backToSignin")}</Link>
          </>
        ) : (
          <>
            <APIErrorAlert error={signup.error} />
            <Form<SignupValues>
              layout="vertical"
              initialValues={{ preferred_language: preferences.language }}
              onFinish={(values) => signup.mutate(values)}
            >
              <Form.Item
                name="display_name"
                label={t("fields.displayName")}
                rules={[
                  {
                    required: true,
                    max: 200,
                    message: t("validation.displayName"),
                  },
                ]}
              >
                <Input autoComplete="name" maxLength={200} />
              </Form.Item>
              <Form.Item
                name="email_address"
                label={t("fields.email")}
                rules={[
                  {
                    required: true,
                    type: "email",
                    message: t("validation.email"),
                  },
                ]}
              >
                <Input autoComplete="email" />
              </Form.Item>
              <Form.Item
                name="preferred_language"
                label={t("fields.language")}
                rules={[{ required: true, message: t("validation.required") }]}
              >
                <Select
                  options={languages.map((language) => ({
                    value: language,
                    label: t(`languages.${language}`),
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="resident_country"
                label={t("fields.residentCountry")}
                rules={[{ required: true, message: t("validation.country") }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={countryCodeValues.map((country) => ({
                    value: country,
                    label: country,
                  }))}
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={signup.isPending}
              >
                {t("signup.action")}
              </Button>
            </Form>
            <Typography.Text>
              {t("signup.haveAccount")}{" "}
              <Link to="/login">{t("signup.signin")}</Link>
            </Typography.Text>
          </>
        )}
      </Space>
    </Card>
  );
}
