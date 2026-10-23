import { SendOutlined } from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Avatar,
  Button,
  Card,
  Flex,
  Form,
  Modal,
  message,
  Select,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContactSummary } from "typespec/orgs/marketplace/contacts/contacts";
import type { Job } from "typespec/orgs/marketplace/work/work";
import { getInitials } from "./presentation";
import { useContactsQuery, useStartConversationMutation } from "./queries";

interface Props {
  open: boolean;
  onClose: () => void;
  job: Job;
  jobContent?: Record<string, unknown>;
  alreadySuggestedContactIds?: Set<string>;
  onSuccess?: () => void;
}

export function SuggestToContactModal({
  open,
  onClose,
  job,
  jobContent,
  alreadySuggestedContactIds = new Set(),
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const suggestKey = useIdempotencyKey("suggest-opening");
  const [selectedContactId, setSelectedContactId] = useState<string>();

  const contactsQuery = useContactsQuery({}, open);
  const contacts = contactsQuery.data?.items ?? [];

  const startConvMutation = useStartConversationMutation();

  const selectedContact: ContactSummary | undefined = useMemo(
    () => contacts.find((c) => c.contact_id === selectedContactId),
    [contacts, selectedContactId],
  );

  const contactOptions = useMemo(() => {
    return contacts.map((c) => {
      const alreadySuggested = alreadySuggestedContactIds.has(c.contact_id);
      const disabled = c.messages_off || alreadySuggested;

      let suffix = "";
      if (c.messages_off) {
        suffix = ` · ${t("marketplace.contacts.messagesOffReason")}`;
      } else if (alreadySuggested) {
        suffix = ` · ${t("marketplace.jobs.alreadySuggested")}`;
      }

      return {
        value: c.contact_id,
        disabled,
        label: (
          <Flex align="center" gap="small">
            <Avatar size="small" style={{ backgroundColor: "#1677ff" }}>
              {getInitials(c.display_name)}
            </Avatar>
            <span>{c.display_name}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              @{c.handle}
              {suffix}
            </Typography.Text>
          </Flex>
        ),
      };
    });
  }, [contacts, alreadySuggestedContactIds, t]);

  const firstName = selectedContact
    ? selectedContact.display_name.split(/\s+/)[0]
    : t("marketplace.jobs.recipientFallback");

  // Derive preview details
  const country = job.opening.employing_country
    ? t(`countries.${job.opening.employing_country}`, {
        defaultValue: job.opening.employing_country,
      })
    : "";
  const workArrangement = (jobContent?.work_arrangement as string) || "";
  const employmentType = (jobContent?.employment_type as string) || "";

  const previewSubtitle = [
    job.client.display_name || job.client.domain,
    country,
    workArrangement
      ? t(`openings.workArrangements.${workArrangement}`, {
          defaultValue: workArrangement,
        })
      : "",
    employmentType
      ? t(`openings.employmentTypes.${employmentType}`, {
          defaultValue: employmentType,
        })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const handleSend = async () => {
    if (!selectedContact) return;
    try {
      await startConvMutation.mutateAsync({
        request: {
          address: selectedContact.handle,
          suggestion: {
            consumer_domain: job.client.domain,
            opening_number: job.opening.number,
          },
        },
        key: suggestKey.current(),
      });
      message.success(t("marketplace.jobs.suggestSuccess"));
      setSelectedContactId(undefined);
      onSuccess?.();
      onClose();
    } catch {
      message.error(t("marketplace.jobs.suggestError"));
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        setSelectedContactId(undefined);
        onClose();
      }}
      title={t("marketplace.jobs.suggestToContactModalTitle")}
      footer={[
        <Button
          key="cancel"
          onClick={() => {
            setSelectedContactId(undefined);
            onClose();
          }}
        >
          {t("actions.cancel")}
        </Button>,
        <Button
          key="submit"
          type="primary"
          icon={<SendOutlined />}
          loading={startConvMutation.isPending}
          disabled={!selectedContact}
          onClick={handleSend}
        >
          {t("marketplace.jobs.sendSuggestion")}
        </Button>,
      ]}
      width={560}
      destroyOnClose
    >
      <Flex vertical gap="middle" style={{ marginTop: 16 }}>
        <Form.Item
          label={t("marketplace.jobs.contactFieldLabel")}
          required
          style={{ marginBottom: 0 }}
        >
          <Select
            showSearch
            placeholder={t("marketplace.jobs.selectContactPlaceholder")}
            value={selectedContactId}
            onChange={setSelectedContactId}
            options={contactOptions}
            filterOption={(input, option) => {
              const c = contacts.find(
                (item) => item.contact_id === option?.value,
              );
              if (!c) return false;
              const q = input.toLowerCase();
              return (
                c.display_name.toLowerCase().includes(q) ||
                c.handle.toLowerCase().includes(q)
              );
            }}
            style={{ width: "100%" }}
          />
        </Form.Item>

        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 13, display: "block", marginBottom: 8 }}
          >
            {t("marketplace.jobs.whatTheyReceive")}
          </Typography.Text>
          <Card
            size="small"
            style={{ backgroundColor: "#fafafa", borderRadius: 8 }}
          >
            <Flex align="center" gap="middle">
              <Avatar
                shape="square"
                size={40}
                style={{ backgroundColor: "#fa8c16", fontWeight: 600 }}
              >
                {getInitials(job.client.display_name || job.client.domain)}
              </Avatar>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Typography.Text
                  strong
                  style={{ fontSize: 14, display: "block" }}
                >
                  {job.opening.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {previewSubtitle}
                </Typography.Text>
              </div>
            </Flex>
          </Card>
        </div>

        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginBottom: 0 }}
        >
          {t("marketplace.jobs.suggestExplainer", { name: firstName })}
        </Typography.Paragraph>
      </Flex>
    </Modal>
  );
}
