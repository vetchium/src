import { QrcodeOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Popconfirm,
  Popover,
  QRCode,
  Space,
  Spin,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isDisplayName } from "typespec/common/localization";
import {
  isPictureContentType,
  MAX_PICTURE_BYTES,
  type PictureContentType,
} from "typespec/hub/profile/picture";
import {
  normalizeSetPublicFieldsRequest,
  type PublicProfile,
  type SetPublicFieldsRequest,
} from "typespec/hub/profile/public";
import { planIncludes, SilverTier } from "typespec/hub/subscriptions/plans";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { ProfileAvatar } from "../../components/common/ProfileAvatar";
import { useMySubscriptionQuery } from "../subscriptions/queries";
import { canonicalProfileURL } from "./canonical";
import { myInfoQueryKey, usePublicProfileQuery } from "./queries";

interface PublicFieldsForm {
  display_name: string;
  biography: string;
}

function AvatarWithPicture({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const subscription = useMySubscriptionQuery();
  const uploadKey = useIdempotencyKey();
  const removeKey = useIdempotencyKey();
  const lastUpload = useRef<string | null>(null);
  const entitled =
    subscription.data !== undefined &&
    planIncludes(subscription.data.plan_oid, SilverTier);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["hub", "profile", address] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // A retried upload of the same bytes replays; a different file must not.
      const signature = `${file.name}:${file.size}:${file.lastModified}`;
      if (lastUpload.current !== null && lastUpload.current !== signature) {
        uploadKey.rotate();
      }
      lastUpload.current = signature;
      return hubAPI.uploadPicture(
        await file.arrayBuffer(),
        file.type as PictureContentType,
        uploadKey.current(),
      );
    },
    onSuccess: async () => {
      uploadKey.rotate();
      lastUpload.current = null;
      await refresh();
      void message.success(t("profilePicture.uploaded"));
    },
  });
  const remove = useMutation({
    mutationFn: () => hubAPI.removePicture(removeKey.current()),
    onSuccess: async () => {
      removeKey.rotate();
      await refresh();
      void message.success(t("profilePicture.removed"));
    },
  });

  return (
    <Space orientation="vertical" align="center" size="small">
      <ProfileAvatar
        size={112}
        displayName={profile.display_name}
        src={profile.profile_picture_url}
        alt={t("profilePicture.currentAlt")}
      />
      {subscription.isPending ? (
        <Spin aria-label={t("profilePicture.loading")} size="small" />
      ) : entitled ? (
        <Space orientation="vertical" size="small" align="center">
          <Upload
            accept="image/jpeg,image/png"
            showUploadList={false}
            maxCount={1}
            beforeUpload={(file) => {
              if (!isPictureContentType(file.type)) {
                void message.error(t("profilePicture.unsupportedType"));
              } else if (file.size > MAX_PICTURE_BYTES) {
                void message.error(t("profilePicture.tooLarge"));
              } else {
                upload.mutate(file as unknown as File);
              }
              // The request is issued above; antd must not upload again.
              return Upload.LIST_IGNORE;
            }}
          >
            <Button size="small" loading={upload.isPending}>
              {profile.profile_picture_url === undefined
                ? t("profilePicture.upload")
                : t("profilePicture.replace")}
            </Button>
          </Upload>
          <Popconfirm
            title={t("profilePicture.confirmRemove")}
            okText={t("profilePicture.remove")}
            cancelText={t("common.cancel")}
            onConfirm={() => remove.mutate()}
          >
            <Button
              size="small"
              danger
              type="text"
              disabled={
                profile.profile_picture_url === undefined || remove.isPending
              }
              loading={remove.isPending}
            >
              {t("profilePicture.remove")}
            </Button>
          </Popconfirm>
        </Space>
      ) : (
        <Space orientation="vertical" size={0} align="center">
          <Typography.Text type="secondary" style={{ textAlign: "center" }}>
            {t("profilePicture.upgradeRequired")}
          </Typography.Text>
          <Link to="/plan">{t("profilePicture.viewPlans")}</Link>
        </Space>
      )}
      <APIErrorAlert error={upload.error ?? remove.error} />
    </Space>
  );
}

function IntroductionForm({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<PublicFieldsForm>();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  const savedFields = useRef<PublicFieldsForm>({
    display_name: profile.display_name,
    biography: profile.biography ?? "",
  });
  const save = useMutation({
    mutationFn: (request: SetPublicFieldsRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.setPublicFields(request, key.current());
    },
    onSuccess: async (_, request) => {
      key.rotate();
      lastPayload.current = null;
      savedFields.current = {
        display_name: request.display_name,
        biography: request.biography ?? "",
      };
      form.setFieldsValue(savedFields.current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      void message.success(t("profile.publicFieldsSaved"));
    },
  });

  return (
    <Form<PublicFieldsForm>
      form={form}
      layout="vertical"
      initialValues={{
        display_name: profile.display_name,
        biography: profile.biography ?? "",
      }}
      onFinish={(values) =>
        save.mutate(
          normalizeSetPublicFieldsRequest({
            display_name: values.display_name,
            biography: values.biography,
          }),
        )
      }
    >
      <Form.Item
        name="display_name"
        label={t("fields.displayName")}
        rules={[
          {
            validator: async (_, value: string) => {
              if (!isDisplayName(value ?? "")) {
                throw new Error(t("profile.displayNameInvalid"));
              }
            },
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        name="biography"
        label={t("profile.biography")}
        rules={[
          {
            validator: async (_, value: string) => {
              if ([...(value ?? "")].length > 2000) {
                throw new Error(t("profile.biographyTooLong"));
              }
            },
          },
        ]}
      >
        <Input.TextArea rows={3} />
      </Form.Item>
      <Space>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          {t("profile.savePublicFields")}
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            form.setFieldsValue(savedFields.current);
            save.reset();
          }}
        >
          {t("profile.discardChanges")}
        </Button>
      </Space>
      <APIErrorAlert error={save.error} />
    </Form>
  );
}

function ProfileHeaderContent({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <Flex gap="large" wrap align="start">
        <AvatarWithPicture address={address} profile={profile} />
        <Flex vertical flex={1} gap="small" className="full-width">
          <div>
            <Typography.Title level={2} style={{ marginBottom: 0 }}>
              {profile.display_name}
            </Typography.Title>
            <Space size="small" split={<span>·</span>}>
              <Typography.Text type="secondary">
                @{profile.handle}
              </Typography.Text>
              <Link to={`/u/${profile.handle}`}>
                {t("profile.viewPublicProfile")}
              </Link>
              <Popover
                trigger="click"
                content={
                  <Space orientation="vertical" align="center">
                    <QRCode
                      value={canonicalProfileURL(profile.handle)}
                      size={160}
                      aria-label={t("profile.shareQrAlt")}
                    />
                    <Typography.Text
                      copyable={{ text: canonicalProfileURL(profile.handle) }}
                    >
                      {canonicalProfileURL(profile.handle)}
                    </Typography.Text>
                  </Space>
                }
              >
                <Tooltip title={t("profile.shareQr")}>
                  <Button
                    type="text"
                    size="small"
                    icon={<QrcodeOutlined />}
                    aria-label={t("profile.shareQr")}
                  />
                </Tooltip>
              </Popover>
            </Space>
          </div>
          <IntroductionForm address={address} profile={profile} />
        </Flex>
      </Flex>
    </Card>
  );
}

export function ProfileHeaderCard({ address }: { address: string }) {
  const { t } = useTranslation();
  const profile = usePublicProfileQuery(address);
  if (profile.isPending) {
    return (
      <Card>
        <Spin aria-label={t("profile.loadingPublicFields")} />
      </Card>
    );
  }
  if (profile.isError) {
    return (
      <Card>
        <APIErrorAlert error={profile.error} />
        <Button onClick={() => void profile.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  return <ProfileHeaderContent address={address} profile={profile.data} />;
}
