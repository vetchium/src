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
  Timeline,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isProfessionalDomain,
  normalizeProfessionalDomain,
} from "typespec/common/domain";
import {
  isProfileTitle,
  normalizeSaveWorkExperienceRequest,
  type ProfileMonth,
  type PublicProfile,
  type SaveWorkExperienceRequest,
  validateSaveWorkExperienceRequest,
  type WorkExperience,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePreferences } from "../../app/PreferencesContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { DomainFavicon } from "./DomainFavicon";
import { MonthSelect } from "./MonthSelect";
import { myInfoQueryKey, usePublicProfileQuery } from "./queries";

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

interface WorkExperienceFormValues {
  employer_domain: string;
  job_title: string;
  start_month?: ProfileMonth;
  end_month?: ProfileMonth;
  location: string;
  description: string;
}

function toRequest(
  id: string | undefined,
  values: WorkExperienceFormValues,
): SaveWorkExperienceRequest {
  return normalizeSaveWorkExperienceRequest({
    id,
    employer_domain: values.employer_domain,
    job_title: values.job_title,
    start_month: values.start_month ?? "",
    end_month: values.end_month ?? null,
    location: values.location || null,
    description: values.description || null,
  });
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
  const queryClient = useQueryClient();
  const [form] = Form.useForm<WorkExperienceFormValues>();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: (request: SaveWorkExperienceRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.saveWorkExperience(request, key.current());
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
        entry === undefined ? t("profileWork.added") : t("profileWork.updated"),
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
        entry === undefined ? "profileWork.addTitle" : "profileWork.editTitle",
      )}
      okText={t(entry === undefined ? "profileWork.add" : "common.save")}
      cancelText={t("common.cancel")}
      cancelButtonProps={{ disabled: save.isPending }}
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form<WorkExperienceFormValues>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          employer_domain: entry?.employer_domain ?? "",
          job_title: entry?.job_title ?? "",
          start_month: entry?.start_month,
          end_month: entry?.end_month,
          location: entry?.location ?? "",
          description: entry?.description ?? "",
        }}
        onFinish={(values) => {
          const request = toRequest(entry?.id, values);
          const invalid = validateSaveWorkExperienceRequest(request);
          if (invalid.length > 0) {
            form.setFields(
              invalid.map((name) => ({
                name: name as keyof WorkExperienceFormValues,
                errors: [t(`profileWork.validation.${name}`)],
              })),
            );
            return;
          }
          save.mutate(request);
        }}
      >
        <Form.Item
          name="employer_domain"
          label={t("profileWork.fields.employerDomain")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (
                  !isProfessionalDomain(
                    normalizeProfessionalDomain(value ?? ""),
                  )
                ) {
                  throw new Error(t("profileWork.validation.employer_domain"));
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="job_title"
          label={t("profileWork.fields.jobTitle")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (!isProfileTitle(value ?? "")) {
                  throw new Error(t("profileWork.validation.job_title"));
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="start_month"
          label={t("profileWork.fields.startMonth")}
          rules={[
            {
              validator: async (_, value: ProfileMonth | undefined) => {
                if (value === undefined) {
                  throw new Error(t("profileWork.validation.start_month"));
                }
              },
            },
          ]}
        >
          <MonthSelect ariaLabel={t("profileWork.fields.startMonth")} />
        </Form.Item>
        <Form.Item
          name="end_month"
          label={t("profileWork.fields.endMonth")}
          dependencies={["start_month"]}
          rules={[
            {
              validator: async (_, value: ProfileMonth | undefined) => {
                const start = form.getFieldValue("start_month") as
                  | ProfileMonth
                  | undefined;
                if (
                  value !== undefined &&
                  start !== undefined &&
                  value < start
                ) {
                  throw new Error(t("profileWork.validation.end_month"));
                }
              },
            },
          ]}
        >
          <MonthSelect
            allowClear
            ariaLabel={t("profileWork.fields.endMonth")}
          />
        </Form.Item>
        <Form.Item
          name="location"
          label={t("profileWork.fields.location")}
          rules={[
            {
              validator: async (_, value: string) => {
                if ([...(value ?? "")].length > 200) {
                  throw new Error(t("profileWork.validation.location"));
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="description"
          label={t("profileWork.fields.description")}
          rules={[
            {
              validator: async (_, value: string) => {
                if ([...(value ?? "")].length > 2000) {
                  throw new Error(t("profileWork.validation.description"));
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
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
        <DomainFavicon value={entry.employer_domain} />
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
