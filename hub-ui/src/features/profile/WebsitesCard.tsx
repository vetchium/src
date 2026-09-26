import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isWebsiteURL,
  MaxWebsites,
  normalizeSaveWebsiteRequest,
  normalizeWebsiteURL,
  type PublicProfile,
  type SaveWebsiteRequest,
  validateSaveWebsiteRequest,
  type Website,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey, usePublicProfileQuery } from "./queries";
import { WebsiteLink } from "./WebsiteLink";

interface WebsiteFormValues {
  url: string;
}

function WebsiteModal({
  address,
  entry,
  others,
  open,
  onClose,
}: {
  address: string;
  entry: Website | undefined;
  others: Website[];
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<WebsiteFormValues>();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: (request: SaveWebsiteRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.saveWebsite(request, key.current());
    },
    onSuccess: async () => {
      key.rotate();
      lastPayload.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      void message.success(
        entry === undefined
          ? t("profileWebsites.added")
          : t("profileWebsites.updated"),
      );
      onClose();
    },
  });

  return (
    <Modal
      destroyOnHidden
      open={open}
      closable={!save.isPending}
      keyboard={!save.isPending}
      mask={{ closable: !save.isPending }}
      title={t(
        entry === undefined
          ? "profileWebsites.addTitle"
          : "profileWebsites.editTitle",
      )}
      okText={t(entry === undefined ? "profileWebsites.add" : "common.save")}
      cancelText={t("common.cancel")}
      cancelButtonProps={{ disabled: save.isPending }}
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form<WebsiteFormValues>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ url: entry?.url ?? "" }}
        onFinish={(values) => {
          const request = normalizeSaveWebsiteRequest({
            id: entry?.id,
            url: values.url,
          });
          if (validateSaveWebsiteRequest(request).length > 0) {
            form.setFields([
              {
                name: "url",
                errors: [t("profileWebsites.validation.url")],
              },
            ]);
            return;
          }
          if (others.some((other) => other.url === request.url)) {
            form.setFields([
              {
                name: "url",
                errors: [t("profileWebsites.validation.duplicate")],
              },
            ]);
            return;
          }
          save.mutate(request);
        }}
      >
        <Form.Item
          name="url"
          label={t("profileWebsites.fields.url")}
          extra={t("profileWebsites.help")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (!isWebsiteURL(normalizeWebsiteURL(value ?? ""))) {
                  throw new Error(t("profileWebsites.validation.url"));
                }
              },
            },
          ]}
        >
          <Input
            autoComplete="url"
            inputMode="url"
            placeholder={t("profileWebsites.placeholder")}
          />
        </Form.Item>
      </Form>
      <APIErrorAlert error={save.error} />
    </Modal>
  );
}

function WebsiteRow({
  address,
  entry,
  onEdit,
}: {
  address: string;
  entry: Website;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const deleteKey = useIdempotencyKey();
  const remove = useMutation({
    mutationFn: () =>
      hubAPI.deleteWebsite({ id: entry.id }, deleteKey.current()),
    onSuccess: async () => {
      deleteKey.rotate();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      void message.success(t("profileWebsites.removed"));
    },
  });

  return (
    <li>
      <Flex justify="space-between" align="center" gap="middle" wrap>
        <Space orientation="vertical" size={0} style={{ minWidth: 0 }}>
          <WebsiteLink url={entry.url} />
          <Typography.Text
            type="secondary"
            style={{ overflowWrap: "anywhere" }}
          >
            {entry.url}
          </Typography.Text>
        </Space>
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={t("profileWebsites.editEntry", { url: entry.url })}
            onClick={onEdit}
          />
          <Popconfirm
            title={t("profileWebsites.confirmDelete")}
            okText={t("profileWebsites.delete")}
            cancelText={t("profileWebsites.cancel")}
            onConfirm={() => remove.mutate()}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              aria-label={t("profileWebsites.deleteEntry", { url: entry.url })}
              disabled={remove.isPending}
              loading={remove.isPending}
            />
          </Popconfirm>
        </Space>
      </Flex>
      <APIErrorAlert error={remove.error} />
    </li>
  );
}

function WebsitesListCard({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Website | null | undefined>(undefined);
  // PROF-WEB-005: the server returns them oldest-added first.
  const entries = profile.websites;
  const atLimit = entries.length >= MaxWebsites;

  return (
    <Card
      title={t("profileWebsites.title")}
      extra={
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          disabled={atLimit}
          onClick={() => setEditing(null)}
        >
          {t("profileWebsites.add")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        {t("profileWebsites.description")}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {t("profileWebsites.disclaimer")}
      </Typography.Paragraph>
      {atLimit ? (
        <Typography.Paragraph type="secondary">
          {t("profileWebsites.limitReached", { limit: MaxWebsites })}
        </Typography.Paragraph>
      ) : null}
      {entries.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileWebsites.empty")}
        </Typography.Paragraph>
      ) : (
        <ul>
          {entries.map((entry) => (
            <WebsiteRow
              key={entry.id}
              address={address}
              entry={entry}
              onEdit={() => setEditing(entry)}
            />
          ))}
        </ul>
      )}
      <WebsiteModal
        address={address}
        entry={editing ?? undefined}
        others={entries.filter((entry) => entry.id !== editing?.id)}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />
    </Card>
  );
}

export function WebsitesCard({ address }: { address: string }) {
  const { t } = useTranslation();
  const profile = usePublicProfileQuery(address);
  if (profile.isPending) {
    return (
      <Card title={t("profileWebsites.title")}>
        <Spin aria-label={t("profileWebsites.loading")} />
      </Card>
    );
  }
  if (profile.isError) {
    return (
      <Card title={t("profileWebsites.title")}>
        <APIErrorAlert error={profile.error} />
        <Button onClick={() => void profile.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  return <WebsitesListCard address={address} profile={profile.data} />;
}
