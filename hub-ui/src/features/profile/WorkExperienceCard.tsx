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
  ProfileMonth,
  PublicProfile,
  WorkExperience,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePreferences } from "../../app/PreferencesContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey, usePublicProfileQuery } from "./queries";
import {
  useSaveWorkExperience,
  WorkExperienceForm,
  type WorkExperienceFormValues,
} from "./WorkExperienceForm";

const workExperienceLimit = 50;

/** PROF-EXP-007: current experiences first, then descending start month. */
function compareWorkExperience(a: WorkExperience, b: WorkExperience): number {
  const aCurrent = a.end_month === undefined;
  const bCurrent = b.end_month === undefined;
  if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
  if (a.start_month !== b.start_month) {
    return a.start_month > b.start_month ? -1 : 1;
  }
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function WorkExperienceModal({
  address,
  entry,
  open,
  onClose,
}: {
  address: string;
  entry: WorkExperience | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<WorkExperienceFormValues>();
  const save = useSaveWorkExperience(address, () => {
    void message.success(
      t(entry === undefined ? "profileWork.added" : "profileWork.updated"),
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
        entry === undefined ? "profileWork.addTitle" : "profileWork.editTitle",
      )}
      okText={t(entry === undefined ? "profileWork.add" : "common.save")}
      cancelText={t("common.cancel")}
      cancelButtonProps={{ disabled: save.isPending }}
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <WorkExperienceForm
        form={form}
        entry={entry}
        onSave={(request) => save.mutate(request)}
      />
      <APIErrorAlert error={save.error} />
    </Modal>
  );
}

function WorkExperienceEntry({
  address,
  entry,
  onEdit,
}: {
  address: string;
  entry: WorkExperience;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const deleteKey = useIdempotencyKey();
  const remove = useMutation({
    mutationFn: () =>
      hubAPI.deleteWorkExperience({ id: entry.id }, deleteKey.current()),
    onSuccess: async () => {
      deleteKey.rotate();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      void message.success(t("profileWork.removed"));
    },
  });
  const month = (value?: ProfileMonth) =>
    value === undefined
      ? t("profileWork.present")
      : new Intl.DateTimeFormat(preferences.language, {
          year: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${value}-01T00:00:00Z`));

  return (
    <Flex justify="space-between" align="start" gap="middle" wrap>
      <Space orientation="vertical" size="small">
        <Typography.Text strong>{entry.job_title}</Typography.Text>
        <Typography.Text>{entry.employer_domain}</Typography.Text>
        <Typography.Text type="secondary">
          {t("profileWork.dateRange", {
            start: month(entry.start_month),
            end: month(entry.end_month),
          })}
        </Typography.Text>
        {entry.location !== undefined ? (
          <Typography.Text>{entry.location}</Typography.Text>
        ) : null}
        {entry.description !== undefined ? (
          <Typography.Paragraph>{entry.description}</Typography.Paragraph>
        ) : null}
        <APIErrorAlert error={remove.error} />
      </Space>
      <Space size="small">
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          aria-label={t("profileWork.editEntry", { title: entry.job_title })}
          onClick={onEdit}
        />
        <Popconfirm
          title={t("profileWork.confirmDelete")}
          okText={t("profileWork.delete")}
          cancelText={t("profileWork.cancel")}
          onConfirm={() => remove.mutate()}
        >
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            aria-label={t("profileWork.deleteEntry", {
              title: entry.job_title,
            })}
            disabled={remove.isPending}
            loading={remove.isPending}
          />
        </Popconfirm>
      </Space>
    </Flex>
  );
}

function WorkExperienceListCard({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<WorkExperience | null | undefined>(
    undefined,
  );
  const entries = [...profile.work_experiences].sort(compareWorkExperience);
  const atLimit = profile.work_experiences.length >= workExperienceLimit;

  return (
    <Card
      title={t("profileWork.title")}
      extra={
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          disabled={atLimit}
          onClick={() => setEditing(null)}
        >
          {t("profileWork.add")}
        </Button>
      }
    >
      {atLimit ? (
        <Typography.Paragraph type="secondary">
          {t("profileWork.limitReached")}
        </Typography.Paragraph>
      ) : null}
      {entries.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileWork.empty")}
        </Typography.Paragraph>
      ) : (
        <Timeline
          items={entries.map((entry) => ({
            key: entry.id,
            content: (
              <WorkExperienceEntry
                address={address}
                entry={entry}
                onEdit={() => setEditing(entry)}
              />
            ),
          }))}
        />
      )}
      <WorkExperienceModal
        address={address}
        entry={editing ?? undefined}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />
    </Card>
  );
}

export function WorkExperienceCard({ address }: { address: string }) {
  const { t } = useTranslation();
  const profile = usePublicProfileQuery(address);
  if (profile.isPending) {
    return (
      <Card title={t("profileWork.title")}>
        <Spin aria-label={t("profileWork.loading")} />
      </Card>
    );
  }
  if (profile.isError) {
    return (
      <Card title={t("profileWork.title")}>
        <APIErrorAlert error={profile.error} />
        <Button onClick={() => void profile.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  return <WorkExperienceListCard address={address} profile={profile.data} />;
}
