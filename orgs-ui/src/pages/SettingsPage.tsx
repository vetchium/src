import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Image,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  DomainFailing,
  DomainReleased,
  type DomainVerificationState,
  DomainVerified,
} from "typespec/orgs/account/account";
import { holds, ManageBilling } from "typespec/orgs/authorization/types";
import {
  isLogoContentType,
  type LogoContentType,
  maxLogoBytes,
} from "typespec/orgs/settings/logo";
import { allowsLogo } from "typespec/orgs/subscriptions/plans";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { CompanyDetailsForm } from "../features/account/CompanyDetailsForm";
import { myInfoQueryKey, useMyInfoQuery } from "../features/account/queries";

const domainStateColors: Record<DomainVerificationState, string> = {
  [DomainVerified]: "green",
  [DomainFailing]: "orange",
  [DomainReleased]: "red",
};

export function SettingsPage() {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
  const upload = useMutation({
    mutationFn: (file: { image: File; contentType: LogoContentType }) =>
      orgsAPI.uploadLogo(file.image, file.contentType, crypto.randomUUID()),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => orgsAPI.removeLogo(crypto.randomUUID()),
    onSuccess: refresh,
  });
  if (me === undefined) return null;
  const entitled = allowsLogo(me.plan_oid);
  const { domain } = me.org;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("settings.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("settings.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("settings.description")}
        </Typography.Text>
      </div>
      <Card title={t("company.identity")} data-testid="logo-card">
        <Flex orientation="vertical" gap="middle">
          <CompanyDetailsForm org={me.org} />
          <Typography.Paragraph type="secondary">
            {t("settings.logo.help")}
          </Typography.Paragraph>
          {me.logo_url === undefined ? (
            <Typography.Text data-testid="logo-none">
              {t("settings.logo.none")}
            </Typography.Text>
          ) : (
            <Image
              src={me.logo_url}
              alt={t("settings.logo.alt", { name: me.org.display_name })}
              width={128}
              preview={false}
              referrerPolicy="no-referrer"
              data-testid="logo-image"
            />
          )}
          {entitled ? null : (
            <Typography.Text type="secondary" data-testid="logo-upgrade">
              {t("settings.logo.upgrade")}{" "}
              {holds(me.permissions, ManageBilling) ? (
                <Link to={paths.plans}>{t("settings.logo.seePlans")}</Link>
              ) : null}
            </Typography.Text>
          )}
          {localError === null ? null : (
            <Alert type="error" showIcon title={t(localError)} />
          )}
          <APIErrorAlert error={upload.error ?? remove.error} />
          <Flex gap="small" wrap>
            <Upload
              accept="image/png,image/jpeg"
              showUploadList={false}
              disabled={!entitled || upload.isPending}
              beforeUpload={(file) => {
                // The API is the authority; this only spares uploading a body
                // it would refuse before reading.
                const contentType = file.type;
                if (!isLogoContentType(contentType)) {
                  setLocalError("errors.logoInvalid");
                } else if (file.size > maxLogoBytes) {
                  setLocalError("errors.logoTooLarge");
                } else {
                  setLocalError(null);
                  upload.mutate({ image: file, contentType });
                }
                return false;
              }}
            >
              <Button
                icon={<UploadOutlined />}
                disabled={!entitled}
                loading={upload.isPending}
              >
                {t(
                  me.logo_url === undefined
                    ? "settings.logo.upload"
                    : "settings.logo.replace",
                )}
              </Button>
            </Upload>
            {me.logo_url === undefined ? null : (
              <Button
                icon={<DeleteOutlined />}
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {t("settings.logo.remove")}
              </Button>
            )}
          </Flex>
        </Flex>
      </Card>
      <Card title={t("settings.domain.title")} data-testid="domain-card">
        <Descriptions
          column={1}
          items={[
            {
              key: "domain",
              label: t("fields.domain"),
              children: (
                <Flex gap="small" wrap align="center">
                  <Typography.Text strong data-testid="domain-name">
                    {domain.domain}
                  </Typography.Text>
                  <Tag
                    color={domainStateColors[domain.state]}
                    data-testid="domain-state"
                    data-state={domain.state}
                  >
                    {t(`domain.states.${domain.state}`)}
                  </Tag>
                </Flex>
              ),
            },
            {
              key: "verified",
              label: t("fields.lastVerified"),
              children: dateTime(domain.last_verified_at),
            },
            ...(domain.failing_since === null
              ? []
              : [
                  {
                    key: "failing",
                    label: t("fields.failingSince"),
                    children: dateTime(domain.failing_since),
                  },
                ]),
            ...(domain.release_after === null
              ? []
              : [
                  {
                    key: "release",
                    label: t("fields.releaseAfter"),
                    children: dateTime(domain.release_after),
                  },
                ]),
          ]}
        />
      </Card>
    </Space>
  );
}
