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
  type EducationalQualification,
  isProfileTitle,
  normalizeSaveEducationalQualificationRequest,
  type ProfileMonth,
  type PublicProfile,
  type SaveEducationalQualificationRequest,
  validateSaveEducationalQualificationRequest,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePreferences } from "../../app/PreferencesContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { DomainFavicon } from "./DomainFavicon";
import { MonthSelect } from "./MonthSelect";
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

interface EducationFormValues {
  institution_domain: string;
  degree: string;
  title: string;
  supporting_text: string;
  start_month?: ProfileMonth;
  end_month?: ProfileMonth;
}

function toRequest(
  id: string | undefined,
  values: EducationFormValues,
): SaveEducationalQualificationRequest {
  return normalizeSaveEducationalQualificationRequest({
    id,
    institution_domain: values.institution_domain,
    degree: values.degree,
    title: values.title || null,
    supporting_text: values.supporting_text || null,
    start_month: values.start_month ?? null,
    end_month: values.end_month ?? null,
  });
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
  const queryClient = useQueryClient();
  const [form] = Form.useForm<EducationFormValues>();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: (request: SaveEducationalQualificationRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.saveEducation(request, key.current());
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
          ? t("profileEducation.added")
          : t("profileEducation.updated"),
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
      <Form<EducationFormValues>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          institution_domain: entry?.institution_domain ?? "",
          degree: entry?.degree ?? "",
          title: entry?.title ?? "",
          supporting_text: entry?.supporting_text ?? "",
          start_month: entry?.start_month,
          end_month: entry?.end_month,
        }}
        onFinish={(values) => {
          const request = toRequest(entry?.id, values);
          const invalid = validateSaveEducationalQualificationRequest(request);
          if (invalid.length > 0) {
            form.setFields(
              invalid.map((name) => ({
                name: name as keyof EducationFormValues,
                errors: [t(`profileEducation.validation.${name}`)],
              })),
            );
            return;
          }
          save.mutate(request);
        }}
      >
        <Form.Item
          name="institution_domain"
          label={t("profileEducation.fields.institutionDomain")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (
                  !isProfessionalDomain(
                    normalizeProfessionalDomain(value ?? ""),
                  )
                ) {
                  throw new Error(
                    t("profileEducation.validation.institution_domain"),
                  );
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="degree"
          label={t("profileEducation.fields.degree")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (!isProfileTitle(value ?? "")) {
                  throw new Error(t("profileEducation.validation.degree"));
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="title"
          label={t("profileEducation.fields.title")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (value && !isProfileTitle(value)) {
                  throw new Error(t("profileEducation.validation.title"));
                }
              },
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="supporting_text"
          label={t("profileEducation.fields.supportingText")}
          rules={[
            {
              validator: async (_, value: string) => {
                if ([...(value ?? "")].length > 249) {
                  throw new Error(
                    t("profileEducation.validation.supporting_text"),
                  );
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="start_month"
          label={t("profileEducation.fields.startMonth")}
        >
          <MonthSelect
            allowClear
            ariaLabel={t("profileEducation.fields.startMonth")}
          />
        </Form.Item>
        <Form.Item
          name="end_month"
          label={t("profileEducation.fields.endMonth")}
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
                  throw new Error(t("profileEducation.validation.end_month"));
                }
              },
            },
          ]}
        >
          <MonthSelect
            allowClear
            ariaLabel={t("profileEducation.fields.endMonth")}
          />
        </Form.Item>
      </Form>
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
        <DomainFavicon value={entry.institution_domain} />
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
