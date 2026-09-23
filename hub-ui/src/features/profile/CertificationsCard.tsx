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
  type Certification,
  isCredentialURL,
  isProfileTitle,
  normalizeSaveCertificationRequest,
  type PublicProfile,
  type SaveCertificationRequest,
  validateSaveCertificationRequest,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey, usePublicProfileQuery } from "./queries";

const certificationLimit = 50;

/** PROF-CER-004: newest-created first. Entry ids are time-ordered UUIDs. */
function compareCertification(a: Certification, b: Certification): number {
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

interface CertificationFormValues {
  title: string;
  credential_url: string;
}

function toRequest(
  id: string | undefined,
  values: CertificationFormValues,
): SaveCertificationRequest {
  return normalizeSaveCertificationRequest({
    id,
    title: values.title,
    credential_url: values.credential_url,
  });
}

function CertificationModal({
  address,
  entry,
  open,
  onClose,
}: {
  address: string;
  entry: Certification | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CertificationFormValues>();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: (request: SaveCertificationRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.saveCertification(request, key.current());
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
          ? t("profileCertifications.added")
          : t("profileCertifications.updated"),
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
          ? "profileCertifications.addTitle"
          : "profileCertifications.editTitle",
      )}
      okText={t(
        entry === undefined ? "profileCertifications.add" : "common.save",
      )}
      cancelText={t("common.cancel")}
      cancelButtonProps={{ disabled: save.isPending }}
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form<CertificationFormValues>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          title: entry?.title ?? "",
          credential_url: entry?.credential_url ?? "",
        }}
        onFinish={(values) => {
          const request = toRequest(entry?.id, values);
          const invalid = validateSaveCertificationRequest(request);
          if (invalid.length > 0) {
            form.setFields(
              invalid.map((name) => ({
                name: name as keyof CertificationFormValues,
                errors: [t(`profileCertifications.validation.${name}`)],
              })),
            );
            return;
          }
          save.mutate(request);
        }}
      >
        <Form.Item
          name="title"
          label={t("profileCertifications.fields.title")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (!isProfileTitle(value ?? "")) {
                  throw new Error(t("profileCertifications.validation.title"));
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="credential_url"
          label={t("profileCertifications.fields.credentialUrl")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (!isCredentialURL((value ?? "").trim())) {
                  throw new Error(
                    t("profileCertifications.validation.credential_url"),
                  );
                }
              },
            },
          ]}
        >
          <Input autoComplete="url" />
        </Form.Item>
      </Form>
      <APIErrorAlert error={save.error} />
    </Modal>
  );
}

function CertificationRow({
  address,
  entry,
  onEdit,
}: {
  address: string;
  entry: Certification;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const deleteKey = useIdempotencyKey();
  const remove = useMutation({
    mutationFn: () =>
      hubAPI.deleteCertification({ id: entry.id }, deleteKey.current()),
    onSuccess: async () => {
      deleteKey.rotate();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      void message.success(t("profileCertifications.removed"));
    },
  });

  return (
    <li>
      <Flex justify="space-between" align="center" gap="middle" wrap>
        {isCredentialURL(entry.credential_url) ? (
          <a
            href={entry.credential_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {entry.title}
          </a>
        ) : (
          <Typography.Text>{entry.title}</Typography.Text>
        )}
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={t("profileCertifications.editEntry", {
              title: entry.title,
            })}
            onClick={onEdit}
          />
          <Popconfirm
            title={t("profileCertifications.confirmDelete")}
            okText={t("profileCertifications.delete")}
            cancelText={t("profileCertifications.cancel")}
            onConfirm={() => remove.mutate()}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              aria-label={t("profileCertifications.deleteEntry", {
                title: entry.title,
              })}
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

function CertificationsListCard({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Certification | null | undefined>(
    undefined,
  );
  const entries = [...profile.certifications].sort(compareCertification);
  const atLimit = profile.certifications.length >= certificationLimit;

  return (
    <Card
      title={t("profileCertifications.title")}
      extra={
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          disabled={atLimit}
          onClick={() => setEditing(null)}
        >
          {t("profileCertifications.add")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        {t("profileCertifications.disclaimer")}
      </Typography.Paragraph>
      {atLimit ? (
        <Typography.Paragraph type="secondary">
          {t("profileCertifications.limitReached")}
        </Typography.Paragraph>
      ) : null}
      {entries.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileCertifications.empty")}
        </Typography.Paragraph>
      ) : (
        <ul>
          {entries.map((entry) => (
            <CertificationRow
              key={entry.id}
              address={address}
              entry={entry}
              onEdit={() => setEditing(entry)}
            />
          ))}
        </ul>
      )}
      <CertificationModal
        address={address}
        entry={editing ?? undefined}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />
    </Card>
  );
}

export function CertificationsCard({ address }: { address: string }) {
  const { t } = useTranslation();
  const profile = usePublicProfileQuery(address);
  if (profile.isPending) {
    return (
      <Card title={t("profileCertifications.title")}>
        <Spin aria-label={t("profileCertifications.loading")} />
      </Card>
    );
  }
  if (profile.isError) {
    return (
      <Card title={t("profileCertifications.title")}>
        <APIErrorAlert error={profile.error} />
        <Button onClick={() => void profile.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  return <CertificationsListCard address={address} profile={profile.data} />;
}
