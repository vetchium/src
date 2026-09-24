import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Timeline,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeAddProfessionalEmailRequest,
  type ProfessionalEmail,
  type ProfessionalEmailChallenge,
  validateAddProfessionalEmailRequest,
} from "typespec/hub/profile/professional_email";
import { isProfileEntryID } from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import {
  professionalEmailsQueryKey,
  useProfessionalEmailsQuery,
} from "./queries";

function challengeStorageKey(ownerHandle: string, emailID: string): string {
  return `vetchium.hub.professional-email.${ownerHandle}.${emailID}`;
}

function readChallenge(key: string): ProfessionalEmailChallenge | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored === null) return null;
    const value = JSON.parse(stored) as Partial<ProfessionalEmailChallenge>;
    if (
      typeof value.challenge_id === "string" &&
      isProfileEntryID(value.challenge_id) &&
      typeof value.expires_at === "string" &&
      Date.parse(value.expires_at) > Date.now()
    ) {
      return value as ProfessionalEmailChallenge;
    }
    sessionStorage.removeItem(key);
  } catch {
    // Browser privacy settings may disable session storage.
  }
  return null;
}

function storeChallenge(key: string, value: ProfessionalEmailChallenge | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory challenge still permits verification on this page.
  }
}

function needsAnnualReminder(lastVerifiedAt: string | undefined): boolean {
  if (lastVerifiedAt === undefined) return false;
  const verified = new Date(lastVerifiedAt);
  if (!Number.isFinite(verified.getTime())) return false;
  verified.setUTCFullYear(verified.getUTCFullYear() + 1);
  return verified.getTime() <= Date.now();
}

function ProfessionalEmailRow({
  entry,
  ownerHandle,
}: {
  entry: ProfessionalEmail;
  ownerHandle: string;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const storageKey = challengeStorageKey(ownerHandle, entry.id);
  const [challenge, setChallenge] = useState(() => readChallenge(storageKey));
  const [code, setCode] = useState("");
  const requestKey = useIdempotencyKey();
  const verifyKey = useIdempotencyKey();
  const deleteKey = useIdempotencyKey();
  const lastCode = useRef<string | null>(null);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
  });
  const dateTimeFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  useEffect(() => {
    if (challenge === null) return;
    const delay = Date.parse(challenge.expires_at) - Date.now();
    if (delay <= 0) {
      setChallenge(null);
      storeChallenge(storageKey, null);
      return;
    }
    const timeout = window.setTimeout(() => {
      setChallenge(null);
      storeChallenge(storageKey, null);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [challenge, storageKey]);

  const requestCode = useMutation({
    mutationFn: () =>
      hubAPI.requestProfessionalEmailCode(
        { id: entry.id },
        requestKey.current(),
      ),
    onSuccess: (issued) => {
      requestKey.rotate();
      verifyKey.rotate();
      lastCode.current = null;
      setCode("");
      setChallenge(issued);
      storeChallenge(storageKey, issued);
      void message.success(t("profileEmails.codeSent"));
    },
  });
  const verify = useMutation({
    mutationFn: () => {
      if (challenge === null) throw new Error("Missing verification challenge");
      if (lastCode.current !== null && lastCode.current !== code) {
        verifyKey.rotate();
      }
      lastCode.current = code;
      return hubAPI.verifyProfessionalEmail(
        { id: entry.id, challenge_id: challenge.challenge_id, code },
        verifyKey.current(),
      );
    },
    onSuccess: async () => {
      verifyKey.rotate();
      lastCode.current = null;
      setCode("");
      setChallenge(null);
      storeChallenge(storageKey, null);
      await queryClient.invalidateQueries({
        queryKey: professionalEmailsQueryKey,
      });
      void message.success(t("profileEmails.verified"));
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      hubAPI.deleteProfessionalEmail({ id: entry.id }, deleteKey.current()),
    onSuccess: async () => {
      deleteKey.rotate();
      storeChallenge(storageKey, null);
      await queryClient.invalidateQueries({
        queryKey: professionalEmailsQueryKey,
      });
      void message.success(t("profileEmails.removed"));
    },
  });
  const formatDate = (value: string) => dateFormat.format(new Date(value));

  return (
    <Space orientation="vertical" size="middle">
      <Space orientation="vertical" size={2}>
        <Typography.Text strong>{entry.email_address}</Typography.Text>
        {entry.last_verified_at === undefined ? (
          <Typography.Text type="secondary">
            {t("profileEmails.notVerifiedYet")}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            {t("profileEmails.verifiedDates", {
              first: formatDate(
                entry.first_verified_at ?? entry.last_verified_at,
              ),
              last: formatDate(entry.last_verified_at),
            })}
          </Typography.Text>
        )}
      </Space>
      {needsAnnualReminder(entry.last_verified_at) ? (
        <Alert type="info" showIcon title={t("profileEmails.annualReminder")} />
      ) : null}
      {challenge === null ? null : (
        <Space orientation="vertical" size="small">
          <Typography.Text type="secondary">
            {t("profileEmails.codeExpires", {
              date: dateTimeFormat.format(new Date(challenge.expires_at)),
            })}
          </Typography.Text>
          <Space wrap>
            <Input
              aria-label={t("profileEmails.codeLabel")}
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              style={{ width: 120 }}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button
              type="primary"
              size="small"
              disabled={!/^[0-9]{6}$/.test(code) || verify.isPending}
              loading={verify.isPending}
              onClick={() => verify.mutate()}
            >
              {t("profileEmails.verify")}
            </Button>
          </Space>
        </Space>
      )}
      <Space wrap>
        {challenge === null ? (
          <Button
            size="small"
            disabled={requestCode.isPending}
            loading={requestCode.isPending}
            onClick={() => requestCode.mutate()}
          >
            {t("profileEmails.requestCode")}
          </Button>
        ) : null}
        <Popconfirm
          title={t("profileEmails.confirmRemove")}
          okText={t("profileEmails.remove")}
          cancelText={t("profileEmails.cancel")}
          onConfirm={() => remove.mutate()}
        >
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            disabled={remove.isPending}
            loading={remove.isPending}
          >
            {t("profileEmails.remove")}
          </Button>
        </Popconfirm>
      </Space>
      <APIErrorAlert
        error={requestCode.error ?? verify.error ?? remove.error}
      />
    </Space>
  );
}

function AddEmailModal({
  ownerHandle,
  open,
  onClose,
}: {
  ownerHandle: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ email_address: string }>();
  const addKey = useIdempotencyKey();
  const requestKey = useIdempotencyKey();
  const lastAddress = useRef<string | null>(null);

  const addAndRequestCode = useMutation({
    mutationFn: async (emailAddress: string) => {
      if (
        lastAddress.current !== null &&
        lastAddress.current !== emailAddress
      ) {
        addKey.rotate();
        requestKey.rotate();
      }
      lastAddress.current = emailAddress;
      const created = await hubAPI.addProfessionalEmail(
        { email_address: emailAddress },
        addKey.current(),
      );
      try {
        const challenge = await hubAPI.requestProfessionalEmailCode(
          { id: created.id },
          requestKey.current(),
        );
        storeChallenge(challengeStorageKey(ownerHandle, created.id), challenge);
        requestKey.rotate();
      } catch {
        // The address is saved either way; its own row keeps a "Request
        // code" action so a failed chained request is never a dead end.
      }
      return created;
    },
    onSuccess: async () => {
      addKey.rotate();
      lastAddress.current = null;
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: professionalEmailsQueryKey,
      });
      void message.success(t("profileEmails.added"));
      onClose();
    },
  });

  return (
    <Modal
      destroyOnHidden
      open={open}
      closable={!addAndRequestCode.isPending}
      keyboard={!addAndRequestCode.isPending}
      mask={{ closable: !addAndRequestCode.isPending }}
      title={t("profileEmails.addTitle")}
      okText={t("profileEmails.add")}
      cancelText={t("common.cancel")}
      cancelButtonProps={{ disabled: addAndRequestCode.isPending }}
      confirmLoading={addAndRequestCode.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form<{ email_address: string }>
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={(values) =>
          addAndRequestCode.mutate(
            normalizeAddProfessionalEmailRequest(values).email_address,
          )
        }
      >
        <Form.Item
          name="email_address"
          label={t("profileEmails.addressLabel")}
          rules={[
            {
              validator: async (_, value: string) => {
                const normalized = normalizeAddProfessionalEmailRequest({
                  email_address: value ?? "",
                });
                if (
                  validateAddProfessionalEmailRequest(normalized).length > 0
                ) {
                  throw new Error(t("profileEmails.addressInvalid"));
                }
              },
            },
          ]}
        >
          <Input autoComplete="email" />
        </Form.Item>
      </Form>
      <APIErrorAlert error={addAndRequestCode.error} />
    </Modal>
  );
}

export function ProfessionalEmailsCard({
  ownerHandle,
}: {
  ownerHandle: string;
}) {
  const { t } = useTranslation();
  const list = useProfessionalEmailsQuery();
  const [addOpen, setAddOpen] = useState(false);
  const atLimit = list.isSuccess && list.data.emails.length >= 10;

  return (
    <Card
      title={t("profileEmails.title")}
      extra={
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          disabled={atLimit}
          onClick={() => setAddOpen(true)}
        >
          {t("profileEmails.addButton")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        {t("profileEmails.privacyNote")}
      </Typography.Paragraph>
      {list.isPending ? (
        <Spin aria-label={t("profileEmails.loading")} />
      ) : list.isError ? (
        <Space orientation="vertical">
          <APIErrorAlert error={list.error} />
          <Button onClick={() => void list.refetch()}>
            {t("common.retry")}
          </Button>
        </Space>
      ) : list.data.emails.length === 0 ? (
        <Typography.Paragraph type="secondary">
          {t("profileEmails.empty")}
        </Typography.Paragraph>
      ) : (
        <Timeline
          items={list.data.emails.map((entry) => ({
            key: entry.id,
            color: entry.last_verified_at === undefined ? "gray" : "green",
            icon:
              entry.last_verified_at === undefined ? (
                <ClockCircleOutlined />
              ) : (
                <CheckCircleOutlined />
              ),
            content: (
              <ProfessionalEmailRow entry={entry} ownerHandle={ownerHandle} />
            ),
          }))}
        />
      )}
      <AddEmailModal
        ownerHandle={ownerHandle}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />
    </Card>
  );
}
