import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Flex,
  Image,
  Space,
  Typography,
  Upload,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
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
import { myInfoQueryKey, useMyInfoQuery } from "../features/account/queries";
import { GoogleSignInCard } from "../features/sso/GoogleSignInCard";

export function SettingsPage() {
  const { t } = useTranslation();
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

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("settings.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("settings.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("settings.description")}
        </Typography.Text>
      </div>
      <Card title={t("settings.logo.title")} data-testid="logo-card">
        <Flex orientation="vertical" gap="middle">
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
            <Alert
              type="info"
              showIcon
              data-testid="logo-upgrade"
              title={t("settings.logo.upgrade")}
              action={
                holds(me.permissions, ManageBilling) ? (
                  <Link to={paths.plans}>{t("settings.logo.seePlans")}</Link>
                ) : undefined
              }
            />
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
      <GoogleSignInCard />
    </Space>
  );
}
