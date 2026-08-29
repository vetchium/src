import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Card,
  Descriptions,
  Flex,
  Form,
  Select,
  Space,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  countryCodeValues,
  type FrontendLocale,
} from "typespec/common/localization";
import { hubAPI } from "../api/hub";
import { usePreferences } from "../app/PreferencesContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { myInfoQueryKey, useMyInfoQuery } from "../features/profile/queries";

const languages: FrontendLocale[] = ["en-US", "ta", "de-DE"];

export function ProfilePage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const auth = useAuth();
  const { data: me } = useMyInfoQuery();
  const language = useMutation({
    mutationFn: (preferred_language: FrontendLocale) =>
      hubAPI.setPreferredLanguage({ preferred_language }),
    onSuccess: async (_, value) => {
      preferences.setLanguage(value);
      auth.updateSession({ preferred_language: value });
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("profile.saved"));
    },
  });
  const country = useMutation({
    mutationFn: (resident_country: string) =>
      hubAPI.setResidentCountry({ resident_country }),
    onSuccess: async (_, value) => {
      auth.updateSession({ resident_country: value });
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("profile.saved"));
    },
  });
  if (me === undefined) return null;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("profile.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("profile.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("profile.description")}
        </Typography.Text>
      </div>
      <Card title={t("profile.identity")}>
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: "name",
              label: t("fields.displayName"),
              children: me.display_name,
            },
            {
              key: "email",
              label: t("fields.email"),
              children: me.email_address,
            },
            { key: "handle", label: t("fields.handle"), children: me.handle },
            { key: "did", label: t("fields.did"), children: me.hub_user_did },
          ]}
        />
      </Card>
      <Card title={t("profile.preferences")}>
        <Flex gap="large" wrap>
          <Form layout="vertical" className="preference-form">
            <Form.Item label={t("fields.language")}>
              <Select<FrontendLocale>
                value={me.preferred_language}
                loading={language.isPending}
                options={languages.map((value) => ({
                  value,
                  label: t(`languages.${value}`),
                }))}
                onChange={(value) => language.mutate(value)}
              />
            </Form.Item>
          </Form>
          <Form layout="vertical" className="preference-form">
            <Form.Item label={t("fields.residentCountry")}>
              <Select
                showSearch
                optionFilterProp="label"
                value={me.resident_country}
                loading={country.isPending}
                options={countryCodeValues.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(value) => country.mutate(value)}
              />
            </Form.Item>
          </Form>
        </Flex>
        <APIErrorAlert error={language.error ?? country.error} />
      </Card>
    </Space>
  );
}
