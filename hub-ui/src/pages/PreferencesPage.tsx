import { useMutation, useQueryClient } from "@tanstack/react-query";
import { frontendLocaleOptions } from "@vetchium/portal-ui/localization";
import {
  App,
  Button,
  Card,
  Form,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CountryCode } from "typespec/common/localization";
import type { FrontendLocale } from "typespec/hub/types";
import {
  type MyInfoResponse,
  normalizeSetIdealJobRequest,
  type SetIdealJobRequest,
} from "typespec/hub/users/profile";
import { hubAPI } from "../api/hub";
import { usePreferences } from "../app/PreferencesContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import {
  isIdealJobValid,
  JobSearchFields,
} from "../features/profile/JobSearchFields";
import { myInfoQueryKey, useMyInfoQuery } from "../features/profile/queries";
import { countryOptions } from "../i18n/countries";

/** The ideal job saves through its own Save; the switch saves at once. */
function JobSearchPreferenceFields({ me }: { me: MyInfoResponse }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const saved = me.ideal_job ?? "";
  const [idealJob, setIdealJob] = useState(saved);
  const dirty = idealJob !== saved;
  const valid = isIdealJobValid(idealJob);
  const saveIdealJob = useMutation({
    mutationFn: (request: SetIdealJobRequest) => hubAPI.setIdealJob(request),
    onSuccess: async (_, request) => {
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
      setIdealJob(request.ideal_job);
      void message.success(t("preferences.saved"));
    },
  });
  const looking = useMutation({
    mutationFn: (looking_for_job: boolean) =>
      hubAPI.setLookingForJob({ looking_for_job }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("preferences.saved"));
    },
  });
  return (
    <>
      <JobSearchFields
        idealJob={idealJob}
        onIdealJobChange={setIdealJob}
        lookingForJob={me.looking_for_job}
        onLookingForJobChange={(checked) => looking.mutate(checked)}
        lookingForJobPending={looking.isPending}
        idealJobActions={
          dirty ? (
            <Form.Item>
              <Space wrap>
                <Tag color="warning">{t("preferences.unsavedChanges")}</Tag>
                <Button
                  type="primary"
                  disabled={!valid}
                  loading={saveIdealJob.isPending}
                  onClick={() =>
                    saveIdealJob.mutate(
                      normalizeSetIdealJobRequest({ ideal_job: idealJob }),
                    )
                  }
                >
                  {t("preferences.saveIdealJob")}
                </Button>
                <Button
                  disabled={saveIdealJob.isPending}
                  onClick={() => {
                    setIdealJob(saved);
                    saveIdealJob.reset();
                  }}
                >
                  {t("preferences.discardChanges")}
                </Button>
              </Space>
              <APIErrorAlert error={saveIdealJob.error} />
            </Form.Item>
          ) : null
        }
      />
      <APIErrorAlert error={looking.error} />
    </>
  );
}

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
  const agencyRequests = useMutation({
    mutationFn: (agencies_may_message: boolean) =>
      hubAPI.setAgenciesMayMessage({ agencies_may_message }),
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
            extra={t("preferences.jobCountriesHelp")}
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
          <APIErrorAlert error={jobs.error} />
          <JobSearchPreferenceFields me={me} />
        </Form>
      </Card>
      <Card title={t("preferences.agencyRequestsTitle")}>
        <Space orientation="vertical" size="middle" className="full-width">
          <Space align="center" size="middle">
            <Switch
              aria-label={t("preferences.agenciesMayRequest")}
              checked={me.agencies_may_message ?? true}
              loading={agencyRequests.isPending}
              onChange={(checked) => {
                if (!agencyRequests.isPending) agencyRequests.mutate(checked);
              }}
            />
            <Typography.Text strong>
              {t("preferences.agenciesMayRequest")}
            </Typography.Text>
          </Space>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {t("preferences.agenciesMayRequestHelp1")}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {t("preferences.agenciesMayRequestHelp2")}
          </Typography.Paragraph>
          <APIErrorAlert error={agencyRequests.error} />
        </Space>
      </Card>
    </Space>
  );
}
