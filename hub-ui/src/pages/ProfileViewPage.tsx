import {
  BankOutlined,
  EnvironmentOutlined,
  IdcardOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  TranslationOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Flex,
  List,
  Popover,
  QRCode,
  Space,
  Timeline,
  Typography,
} from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type {
  EducationalQualification,
  LanguageAbility,
  ProfileMonth,
  PublicProfile,
  WorkExperience,
} from "typespec/hub/profile/public";
import {
  isCredentialURL,
  isProfileAddress,
  Reading,
  Speaking,
  Writing,
} from "typespec/hub/profile/public";
import { usePreferences } from "../app/PreferencesContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { canonicalProfileURL } from "../features/profile/canonical";
import {
  useMyInfoQuery,
  usePublicProfileQuery,
} from "../features/profile/queries";
import { countryOptions } from "../i18n/countries";

const abilities: readonly LanguageAbility[] = [Speaking, Reading, Writing];

function SectionCard({
  icon,
  title,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  empty: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card
      title={
        <Space>
          {icon}
          {title}
        </Space>
      }
    >
      {empty ? (
        <Typography.Text type="secondary">
          {t("profileView.empty")}
        </Typography.Text>
      ) : (
        children
      )}
    </Card>
  );
}

function WorkExperienceTimeline({
  entries,
  month,
}: {
  entries: WorkExperience[];
  month: (value?: ProfileMonth) => string;
}) {
  const { t } = useTranslation();
  return (
    <Timeline
      items={entries.map((work) => ({
        key: work.id,
        content: (
          <Space orientation="vertical" size="small">
            <Typography.Text strong>{work.job_title}</Typography.Text>
            <Typography.Text>{work.employer_domain}</Typography.Text>
            <Typography.Text type="secondary">
              {t("profileView.dateRange", {
                start: month(work.start_month),
                end: month(work.end_month),
              })}
            </Typography.Text>
            {work.location !== undefined ? (
              <Typography.Text>{work.location}</Typography.Text>
            ) : null}
            {work.description !== undefined ? (
              <Typography.Paragraph>{work.description}</Typography.Paragraph>
            ) : null}
          </Space>
        ),
      }))}
    />
  );
}

function EducationTimeline({
  entries,
  month,
}: {
  entries: EducationalQualification[];
  month: (value?: ProfileMonth) => string;
}) {
  const { t } = useTranslation();
  return (
    <Timeline
      items={entries.map((education) => ({
        key: education.id,
        content: (
          <Space orientation="vertical" size="small">
            <Typography.Text strong>{education.degree}</Typography.Text>
            <Typography.Text>{education.institution_domain}</Typography.Text>
            {education.title !== undefined ? (
              <Typography.Text>{education.title}</Typography.Text>
            ) : null}
            {education.start_month !== undefined ||
            education.end_month !== undefined ? (
              <Typography.Text type="secondary">
                {t("profileView.dateRange", {
                  start:
                    education.start_month === undefined
                      ? t("profileView.unknown")
                      : month(education.start_month),
                  end: month(education.end_month),
                })}
              </Typography.Text>
            ) : null}
            {education.supporting_text !== undefined ? (
              <Typography.Paragraph>
                {education.supporting_text}
              </Typography.Paragraph>
            ) : null}
          </Space>
        ),
      }))}
    />
  );
}

function ProfileContents({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const { data: me } = useMyInfoQuery();
  const country =
    countryOptions(preferences.language).find(
      (option) => option.value === profile.resident_country,
    )?.label ?? profile.resident_country;
  const month = (value?: ProfileMonth) =>
    value === undefined
      ? t("profileView.present")
      : new Intl.DateTimeFormat(preferences.language, {
          year: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${value}-01T00:00:00Z`));
  const canonicalURL = canonicalProfileURL(profile.handle);
  const languageDisplay = new Intl.DisplayNames([preferences.language], {
    type: "language",
  });

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>
        {t("profileView.documentTitle", { name: profile.display_name })}
      </title>
      <Card>
        <Flex gap="large" wrap align="start">
          <ProfileAvatar
            size={120}
            displayName={profile.display_name}
            src={profile.profile_picture_url}
            alt={t("profileView.pictureAlt", { name: profile.display_name })}
          />
          {/* The text column takes the remaining width and wraps below the
              avatar on narrow screens; minWidth lets long names wrap instead
              of stretching the card. */}
          <Flex vertical gap="small" style={{ flex: "1 1 20rem", minWidth: 0 }}>
            <div>
              <Typography.Title
                level={1}
                style={{ marginBottom: 0, overflowWrap: "anywhere" }}
              >
                {profile.display_name}
              </Typography.Title>
              <Space size="small" wrap separator={<span>·</span>}>
                <Typography.Text type="secondary">
                  @{profile.handle}
                </Typography.Text>
                <Typography.Text type="secondary">
                  <EnvironmentOutlined /> {country}
                </Typography.Text>
              </Space>
            </div>
            <Space size="middle" wrap>
              <Popover
                trigger="click"
                content={
                  <Space orientation="vertical" align="center">
                    <QRCode
                      value={canonicalURL}
                      size={160}
                      aria-label={t("profileView.qrAlt")}
                    />
                    <Typography.Link href={canonicalURL} copyable>
                      {canonicalURL}
                    </Typography.Link>
                  </Space>
                }
              >
                <Button size="small" icon={<QrcodeOutlined />}>
                  {t("profileView.share")}
                </Button>
              </Popover>
              {me?.handle === profile.handle ? (
                <Link to="/settings/profile">{t("profileView.edit")}</Link>
              ) : null}
            </Space>
            {profile.biography !== undefined ? (
              <Typography.Paragraph
                style={{ marginBottom: 0, overflowWrap: "anywhere" }}
              >
                {profile.biography}
              </Typography.Paragraph>
            ) : null}
          </Flex>
        </Flex>
      </Card>
      <SectionCard
        icon={<IdcardOutlined />}
        title={t("profileView.workTitle")}
        empty={profile.work_experiences.length === 0}
      >
        <WorkExperienceTimeline
          entries={profile.work_experiences}
          month={month}
        />
      </SectionCard>
      <SectionCard
        icon={<BankOutlined />}
        title={t("profileView.educationTitle")}
        empty={profile.educational_qualifications.length === 0}
      >
        <EducationTimeline
          entries={profile.educational_qualifications}
          month={month}
        />
      </SectionCard>
      <SectionCard
        icon={<SafetyCertificateOutlined />}
        title={t("profileView.certificationsTitle")}
        empty={profile.certifications.length === 0}
      >
        <List
          itemLayout="horizontal"
          dataSource={profile.certifications}
          renderItem={(certification) => (
            <List.Item>
              <List.Item.Meta
                avatar={<SafetyCertificateOutlined />}
                title={
                  isCredentialURL(certification.credential_url) ? (
                    <a
                      href={certification.credential_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {certification.title}
                    </a>
                  ) : (
                    certification.title
                  )
                }
              />
            </List.Item>
          )}
        />
      </SectionCard>
      <SectionCard
        icon={<TranslationOutlined />}
        title={t("profileView.languagesTitle")}
        empty={profile.language_abilities.length === 0}
      >
        <Space orientation="vertical" size="middle" className="full-width">
          {abilities
            .filter((ability) =>
              profile.language_abilities.some(
                (entry) => entry.ability === ability,
              ),
            )
            .map((ability) => (
              <div key={ability}>
                <Typography.Title level={5}>
                  {t(`profileView.abilities.${ability}`)}
                </Typography.Title>
                <Space wrap>
                  {profile.language_abilities
                    .filter((entry) => entry.ability === ability)
                    .map((entry) => (
                      <Typography.Text key={entry.language_tag}>
                        {languageDisplay.of(entry.language_tag) ??
                          entry.language_tag}
                      </Typography.Text>
                    ))}
                </Space>
              </div>
            ))}
        </Space>
      </SectionCard>
    </Space>
  );
}

export function ProfileViewPage() {
  const { t } = useTranslation();
  const address = useParams().address ?? "";
  const validAddress = isProfileAddress(address);
  const profile = usePublicProfileQuery(address, validAddress);
  if (!validAddress) {
    return <Typography.Text>{t("profileView.notFound")}</Typography.Text>;
  }
  if (profile.isPending) {
    return <Typography.Text>{t("profileView.loading")}</Typography.Text>;
  }
  if (profile.isError) return <APIErrorAlert error={profile.error} />;
  return <ProfileContents profile={profile.data} />;
}
