import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Timeline,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  EducationalQualification,
  ProfileMonth,
  PublicProfile,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePreferences } from "../../app/PreferencesContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import {
  EducationForm,
  type EducationFormValues,
  useSaveEducation,
} from "./EducationForm";
import { myInfoQueryKey, usePublicProfileQuery } from "./queries";

const educationLimit = 30;

/**
 * PROF-EDU-005 partitions entries into four groups by which of start/end
 * month are present, each in descending month order, id as the tie-breaker.
 */
function educationGroup(entry: EducationalQualification): number {
  const hasStart = entry.start_month !== undefined;
  const hasEnd = entry.end_month !== undefined;
  if (hasStart && !hasEnd) return 0;
  if (hasStart && hasEnd) return 1;
  if (!hasStart && hasEnd) return 2;
  return 3;
}

function compareEducation(
  a: EducationalQualification,
  b: EducationalQualification,
): number {
  const groupDiff = educationGroup(a) - educationGroup(b);
  if (groupDiff !== 0) return groupDiff;
  const group = educationGroup(a);
  if (group === 0 || group === 1) {
    if (a.start_month !== b.start_month) {
      return (a.start_month ?? "") > (b.start_month ?? "") ? -1 : 1;
    }
  } else if (group === 2) {
    if (a.end_month !== b.end_month) {
      return (a.end_month ?? "") > (b.end_month ?? "") ? -1 : 1;
    }
  }
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function EducationModal({
  address,
  entry,
  open,
  onClose,
}: {
  address: string;
  entry: EducationalQualification | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<EducationFormValues>();
  const save = useSaveEducation(address, () => {
    void message.success(
      t(
        entry === undefined
          ? "profileEducation.added"
          : "profileEducation.updated",
      ),
    );
    onClose();
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
          ? "profileEducation.addTitle"
          : "profileEducation.editTitle",
      )}
      okText={t(entry === undefined ? "profileEducation.add" : "common.save")}
      cancelText={t("common.cancel")}
      cancelButtonProps={{ disabled: save.isPending }}
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <EducationForm
        form={form}
        entry={entry}
        onSave={(request) => save.mutate(request)}
      />
      <APIErrorAlert error={save.error} />
    </Modal>
  );
}

function EducationEntry({
  address,
  entry,
  onEdit,
}: {
  address: string;
  entry: EducationalQualification;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const deleteKey = useIdempotencyKey();
  const remove = useMutation({
    mutationFn: () =>
      hubAPI.deleteEducation({ id: entry.id }, deleteKey.current()),
    onSuccess: async () => {
      deleteKey.rotate();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      void message.success(t("profileEducation.removed"));
    },
  });
  const month = (value?: ProfileMonth) =>
    value === undefined
      ? undefined
      : new Intl.DateTimeFormat(preferences.language, {
          year: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${value}-01T00:00:00Z`));

  const start = month(entry.start_month);
  const end = month(entry.end_month);

  return (
    <Flex justify="space-between" align="start" gap="middle" wrap>
      <Space orientation="vertical" size="small">
        <Typography.Text strong>{entry.degree}</Typography.Text>
        <Typography.Text>{entry.institution_domain}</Typography.Text>
        {entry.title !== undefined ? (
          <Typography.Text>{entry.title}</Typography.Text>
        ) : null}
        {entry.start_month !== undefined || entry.end_month !== undefined ? (
          <Typography.Text type="secondary">
            {t("profileEducation.dateRange", {
              start: start ?? t("profileEducation.unknown"),
              end: end ?? t("profileEducation.present"),
            })}
          </Typography.Text>
        ) : null}
        {entry.supporting_text !== undefined ? (
          <Typography.Paragraph>{entry.supporting_text}</Typography.Paragraph>
        ) : null}
        <APIErrorAlert error={remove.error} />
      </Space>
      <Space size="small">
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          aria-label={t("profileEducation.editEntry", {
            title: entry.degree,
          })}
          onClick={onEdit}
        />
        <Popconfirm
          title={t("profileEducation.confirmDelete")}
          okText={t("profileEducation.delete")}
          cancelText={t("profileEducation.cancel")}
          onConfirm={() => remove.mutate()}
        >
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            aria-label={t("profileEducation.deleteEntry", {
              title: entry.degree,
            })}
            disabled={remove.isPending}
            loading={remove.isPending}
          />
        </Popconfirm>
      </Space>
    </Flex>
  );
}

function EducationListCard({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<
    EducationalQualification | null | undefined
  >(undefined);
  const entries = [...profile.educational_qualifications].sort(
    compareEducation,
  );
  const atLimit = profile.educational_qualifications.length >= educationLimit;

  return (
    <Card
      title={t("profileEducation.title")}
      extra={
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          disabled={atLimit}
          onClick={() => setEditing(null)}
        >
          {t("profileEducation.add")}
        </Button>
      }
    >
      {atLimit ? (
        <Typography.Paragraph type="secondary">
          {t("profileEducation.limitReached")}
        </Typography.Paragraph>
      ) : null}
      {entries.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileEducation.empty")}
        </Typography.Paragraph>
      ) : (
        <Timeline
          items={entries.map((entry) => ({
            key: entry.id,
            content: (
              <EducationEntry
                address={address}
                entry={entry}
                onEdit={() => setEditing(entry)}
              />
            ),
          }))}
        />
      )}
      <EducationModal
        address={address}
        entry={editing ?? undefined}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />
    </Card>
  );
}

export function EducationCard({ address }: { address: string }) {
  const { t } = useTranslation();
  const profile = usePublicProfileQuery(address);
  if (profile.isPending) {
    return (
      <Card title={t("profileEducation.title")}>
        <Spin aria-label={t("profileEducation.loading")} />
      </Card>
    );
  }
  if (profile.isError) {
    return (
      <Card title={t("profileEducation.title")}>
        <APIErrorAlert error={profile.error} />
        <Button onClick={() => void profile.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  return <EducationListCard address={address} profile={profile.data} />;
}
