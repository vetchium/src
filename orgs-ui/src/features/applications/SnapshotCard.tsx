import { LinkOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Avatar, Card, Descriptions, Flex, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import {
  applicantName,
  countryName,
  languageName,
  useMonthFormat,
} from "./presentation";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

/** A link from the applicant's profile: never trusted, so no referrer. */
function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (!href.startsWith("https://")) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      <LinkOutlined aria-hidden /> {children}
    </a>
  );
}

export function SnapshotCard({ detail }: { detail: ApplicationDetail }) {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const month = useMonthFormat();
  const snapshot = detail.snapshot;
  const name = applicantName(t, {
    display_name: snapshot.display_name,
    removed: detail.removed,
  });
  if (detail.removed) {
    return (
      <Card title={t("applications.snapshot.title")}>
        <Typography.Text type="secondary">
          {t("applications.snapshot.removed")}
        </Typography.Text>
      </Card>
    );
  }
  const period = (start?: string, end?: string) =>
    [
      start ? month(start) : undefined,
      end ? month(end) : t("applications.snapshot.present"),
    ]
      .filter(Boolean)
      .join(" – ");
  const items = [
    {
      key: "country",
      label: t("applications.snapshot.country"),
      children: countryName(i18n.language, snapshot.resident_country),
    },
    ...(snapshot.biography
      ? [
          {
            key: "about",
            label: t("applications.snapshot.about"),
            children: (
              <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                {snapshot.biography}
              </Typography.Text>
            ),
          },
        ]
      : []),
    ...(snapshot.work_experiences.length > 0
      ? [
          {
            key: "work",
            label: t("applications.snapshot.work"),
            children: (
              <Flex vertical gap={4}>
                {snapshot.work_experiences.map((entry) => (
                  <Flex vertical key={entry.id}>
                    <Typography.Text>
                      {entry.job_title} · {entry.employer_domain}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {period(entry.start_month, entry.end_month)}
                    </Typography.Text>
                  </Flex>
                ))}
              </Flex>
            ),
          },
        ]
      : []),
    ...(snapshot.educational_qualifications.length > 0
      ? [
          {
            key: "education",
            label: t("applications.snapshot.education"),
            children: (
              <Flex vertical gap={4}>
                {snapshot.educational_qualifications.map((entry) => (
                  <Flex vertical key={entry.id}>
                    <Typography.Text>
                      {[entry.degree, entry.title, entry.institution_domain]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography.Text>
                    {(entry.start_month || entry.end_month) && (
                      <Typography.Text type="secondary">
                        {period(entry.start_month, entry.end_month)}
                      </Typography.Text>
                    )}
                  </Flex>
                ))}
              </Flex>
            ),
          },
        ]
      : []),
    ...(snapshot.certifications.length > 0
      ? [
          {
            key: "certifications",
            label: t("applications.snapshot.certifications"),
            children: (
              <Flex vertical gap={4}>
                {snapshot.certifications.map((entry) => (
                  <ExternalLink key={entry.id} href={entry.credential_url}>
                    {entry.title}
                  </ExternalLink>
                ))}
              </Flex>
            ),
          },
        ]
      : []),
    ...(snapshot.language_abilities.length > 0
      ? [
          {
            key: "languages",
            label: t("applications.snapshot.languages"),
            children: snapshot.language_abilities
              .map(
                (entry) =>
                  `${languageName(i18n.language, entry.language_tag)} (${t(`applications.snapshot.abilities.${entry.ability}`, { defaultValue: entry.ability })})`,
              )
              .join(", "),
          },
        ]
      : []),
    ...(snapshot.websites.length > 0
      ? [
          {
            key: "websites",
            label: t("applications.snapshot.websites"),
            children: (
              <Flex vertical gap={4}>
                {snapshot.websites.map((entry) => (
                  <ExternalLink key={entry.id} href={entry.url}>
                    {entry.url.replace(/^https:\/\//, "")}
                  </ExternalLink>
                ))}
              </Flex>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card title={t("applications.snapshot.title")}>
      <Flex vertical gap="middle">
        <Flex gap="middle" align="center">
          <Avatar size={48} aria-hidden>
            {initials(name)}
          </Avatar>
          <Typography.Text strong>{name}</Typography.Text>
        </Flex>
        <Descriptions column={1} size="small" items={items} />
        <Typography.Text type="secondary">
          {t("applications.snapshot.captured", {
            date: date(detail.submitted_at),
          })}
        </Typography.Text>
      </Flex>
    </Card>
  );
}
