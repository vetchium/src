import { useMutation, useQueryClient } from "@tanstack/react-query";
import { frontendLocaleOptions } from "@vetchium/portal-ui/localization";
import { App, Card, Form, Select, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { CountryCode } from "typespec/common/localization";
import type { FrontendLocale } from "typespec/hub/types";
import { hubAPI } from "../api/hub";
import { usePreferences } from "../app/PreferencesContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { myInfoQueryKey, useMyInfoQuery } from "../features/profile/queries";
import { countryOptions } from "../i18n/countries";

export function PreferencesPage() {
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
      void message.success(t("preferences.saved"));
    },
  });
  const jobs = useMutation({
    mutationFn: (preferred_job_countries: CountryCode[]) =>
      hubAPI.setPreferredJobCountries({ preferred_job_countries }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("preferences.saved"));
    },
  });
  if (me === undefined) return null;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("preferences.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("preferences.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("preferences.description")}
        </Typography.Text>
      </div>
      <Card title={t("preferences.languageTitle")}>
        <Form layout="vertical" className="settings-form">
          <Form.Item
            label={t("fields.language")}
            help={t("preferences.languageHelp")}
          >
            <Select<FrontendLocale>
              aria-label={t("fields.language")}
              value={me.preferred_language}
              loading={language.isPending}
              options={frontendLocaleOptions(preferences.supportedLocales)}
              onChange={(value) => {
                if (!language.isPending) language.mutate(value);
              }}
            />
          </Form.Item>
        </Form>
        <APIErrorAlert error={language.error} />
      </Card>
      <Card title={t("preferences.jobSearchTitle")}>
        <Form layout="vertical" className="settings-form">
          <Form.Item
            label={t("preferences.jobCountries")}
            help={t("preferences.jobCountriesHelp")}
          >
            <Select
              mode="multiple"
              maxCount={10}
              aria-label={t("preferences.jobCountries")}
              showSearch={{ optionFilterProp: "label" }}
              value={me.preferred_job_countries}
              loading={jobs.isPending}
              options={countryOptions(preferences.language)}
              onChange={(value: CountryCode[]) => {
                if (!jobs.isPending) jobs.mutate(value);
              }}
            />
          </Form.Item>
        </Form>
        <APIErrorAlert error={jobs.error} />
      </Card>
    </Space>
  );
}
