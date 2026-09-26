import {
  GithubOutlined,
  GitlabOutlined,
  GlobalOutlined,
  LinkedinOutlined,
  XOutlined,
} from "@ant-design/icons";
import { Space, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isWebsiteURL } from "typespec/hub/profile/public";
import { describeWebsite, type WebsiteKind } from "./websiteKind";

// The link text already names the site, so the icons are decoration.
const icons: Record<WebsiteKind, ReactNode> = {
  github: <GithubOutlined aria-hidden />,
  gitlab: <GitlabOutlined aria-hidden />,
  linkedin: <LinkedinOutlined aria-hidden />,
  x: <XOutlined aria-hidden />,
  website: <GlobalOutlined aria-hidden />,
};

/**
 * PROF-WEB-007: an external link with an icon from the local icon set, never
 * an image from the linked host. A value that is not a valid HTTPS website
 * URL, such as one from a peer tenant, is shown as text and never linked.
 */
export function WebsiteLink({ url }: { url: string }) {
  const { t } = useTranslation();
  const { kind, host } = describeWebsite(url);
  const label = kind === "website" ? host : t(`profileWebsites.kinds.${kind}`);
  const content = (
    <Space size={4}>
      {icons[kind]}
      {label}
    </Space>
  );
  if (!isWebsiteURL(url)) return <Typography.Text>{content}</Typography.Text>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
      {content}
    </a>
  );
}
