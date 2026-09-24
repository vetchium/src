import { PlusCircleOutlined } from "@ant-design/icons";
import {
  Avatar,
  Button,
  Card,
  Flex,
  Progress,
  Space,
  Spin,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { PublicProfile } from "typespec/hub/profile/public";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { usePublicProfileQuery } from "./queries";

const sections = ["biography", "work", "education", "languages"] as const;

function completedSections(profile: PublicProfile) {
  return {
    biography: profile.biography !== undefined,
    work: profile.work_experiences.length > 0,
    education: profile.educational_qualifications.length > 0,
    languages: profile.language_abilities.length > 0,
  };
}

function ProgressContent({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const completed = completedSections(profile);
  const done = sections.filter((section) => completed[section]).length;
  const progress = t("home.profileProgress", {
    done,
    total: sections.length,
  });

  return (
    <Space orientation="vertical" size="middle" className="full-width">
      <Flex gap="middle" align="center">
        <Avatar size={56} src={profile.profile_picture_url}>
          {profile.display_name.slice(0, 1)}
        </Avatar>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {profile.display_name}
          </Typography.Title>
          <Typography.Text type="secondary">@{profile.handle}</Typography.Text>
        </div>
      </Flex>
      <div>
        <Progress
          percent={(done / sections.length) * 100}
          steps={sections.length}
          showInfo={false}
          aria-label={progress}
        />
        <Typography.Text strong>{progress}</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {done === sections.length
            ? t("home.profileComplete")
            : t("home.profileIncomplete")}
        </Typography.Paragraph>
      </div>
      {done === sections.length ? null : (
        <Space orientation="vertical" size="small">
          {sections
            .filter((section) => !completed[section])
            .map((section) => (
              <Flex key={section} align="center" gap="small">
                <PlusCircleOutlined style={{ color: token.colorPrimary }} />
                <Typography.Text>
                  {t(`home.checklist.${section}`)}
                </Typography.Text>
              </Flex>
            ))}
        </Space>
      )}
      <Flex gap="middle" wrap>
        <Link to="/settings/profile">{t("home.editProfile")}</Link>
        <Link to={`/u/${profile.handle}`}>{t("home.viewProfile")}</Link>
      </Flex>
    </Space>
  );
}

export function ProfileProgressCard({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const profile = usePublicProfileQuery(handle);
  return (
    <Card title={t("home.profileTitle")} style={{ height: "100%" }}>
      {profile.isPending ? (
        <Spin aria-label={t("home.profileLoading")} />
      ) : profile.isError ? (
        <Space orientation="vertical">
          <APIErrorAlert error={profile.error} />
          <Button onClick={() => void profile.refetch()}>
            {t("common.retry")}
          </Button>
        </Space>
      ) : (
        <ProgressContent profile={profile.data} />
      )}
    </Card>
  );
}
