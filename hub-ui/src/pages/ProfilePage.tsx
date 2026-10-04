import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Card, Form, Select, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { CountryCode } from "typespec/common/localization";
import { hubAPI } from "../api/hub";
import { usePreferences } from "../app/PreferencesContext";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { AliasCard } from "../features/profile/AliasCard";
import { CertificationsCard } from "../features/profile/CertificationsCard";
import { EducationCard } from "../features/profile/EducationCard";
import { LanguageAbilitiesCard } from "../features/profile/LanguageAbilitiesCard";
import { ProfileHeaderCard } from "../features/profile/ProfileHeaderCard";
import { myInfoQueryKey, useMyInfoQuery } from "../features/profile/queries";
import { WebsitesCard } from "../features/profile/WebsitesCard";
import { WorkExperienceCard } from "../features/profile/WorkExperienceCard";
import { countryOptions } from "../i18n/countries";

function ResidentCountryCard({
  handle,
  residentCountry,
}: {
  handle: string;
  residentCountry: CountryCode;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const auth = useAuth();
  const country = useMutation({
    mutationFn: (resident_country: CountryCode) =>
      hubAPI.setResidentCountry({ resident_country }),
    onSuccess: async (_, value) => {
      auth.updateSession({ resident_country: value });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", handle],
        }),
      ]);
      void message.success(t("profile.residentCountrySaved"));
    },
  });
  return (
    <Card title={t("profile.locationTitle")}>
      <Form layout="vertical" className="settings-form">
        <Form.Item
          label={t("fields.residentCountry")}
          help={t("profile.residentCountryHelp")}
        >
          <Select
            aria-label={t("fields.residentCountry")}
            showSearch={{ optionFilterProp: "label" }}
            value={residentCountry}
            loading={country.isPending}
            options={countryOptions(preferences.language)}
            onChange={(value) => {
              if (!country.isPending) country.mutate(value);
            }}
          />
        </Form.Item>
      </Form>
      <APIErrorAlert error={country.error} />
    </Card>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
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
      <div>
        <Typography.Title level={3}>
          {t("profile.sectionIdentity")}
        </Typography.Title>
        <Space orientation="vertical" size="large" className="full-width">
          <ProfileHeaderCard address={me.handle} />
          <WebsitesCard address={me.handle} />
          <ResidentCountryCard
            handle={me.handle}
            residentCountry={me.resident_country}
          />
          <AliasCard handle={me.handle} />
        </Space>
      </div>
      <div>
        <Typography.Title level={3}>
          {t("profile.sectionBackground")}
        </Typography.Title>
        <Space orientation="vertical" size="large" className="full-width">
          <WorkExperienceCard address={me.handle} />
          <EducationCard address={me.handle} />
          <CertificationsCard address={me.handle} />
          <LanguageAbilitiesCard address={me.handle} />
        </Space>
      </div>
    </Space>
  );
}
