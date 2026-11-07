import { MessageOutlined, SendOutlined } from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Flex,
  Form,
  Modal,
  Select,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContactSummary } from "typespec/orgs/marketplace/contacts/contacts";
import type { Job } from "typespec/orgs/marketplace/work/work";
import { isDefiniteRefusal } from "../../api/client";
import { getInitials } from "./presentation";
import { chatRequestProblem } from "./problems";
import {
  useContactsQuery,
  useConversationQuery,
  useSendMessageMutation,
} from "./queries";
import {
  type FixedOpening,
  SendChatRequestModal,
} from "./SendChatRequestModal";

interface Props {
  open: boolean;
  onClose: () => void;
  job: Job;
  jobContent?: Record<string, unknown>;
  alreadySuggestedContactIds?: Set<string>;
  onSuccess?: () => void;
}

/**
 * "Suggest to a contact" (MKT-UI-006): a suggestion message where the agency
 * may write, otherwise a chat request with this Opening.
 */
export function SuggestToContactModal({
  open,
  onClose,
  job,
  jobContent,
  alreadySuggestedContactIds = new Set(),
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const suggestKey = useIdempotencyKey("suggest-opening");
  const [selectedContactId, setSelectedContactId] = useState<string>();
  const [requestFor, setRequestFor] = useState<string>();

  const contactsQuery = useContactsQuery({}, open);
  const contacts = contactsQuery.data?.items ?? [];

  const selectedContact: ContactSummary | undefined = useMemo(
    () => contacts.find((c) => c.contact_id === selectedContactId),
    [contacts, selectedContactId],
  );
  const conversationQuery = useConversationQuery(
    selectedContactId ?? "",
    open && selectedContact?.has_conversation === true,
  );
  const writableUntil =
    conversationQuery.data?.pages[0]?.conversation.agency_may_write_until;
  const mayWrite =
    writableUntil !== undefined && Date.parse(writableUntil) > Date.now();
  const sendMessage = useSendMessageMutation(selectedContactId ?? "");

  const opening: FixedOpening = {
    suggestion: {
      consumer_domain: job.client.domain,
      opening_number: job.opening.number,
    },
    title: job.opening.title,
    client: job.client.display_name || job.client.domain,
  };

  const contactOptions = useMemo(() => {
    return contacts.map((c) => {
      const alreadySuggested = alreadySuggestedContactIds.has(c.contact_id);
      let suffix = "";
      if (c.account_deleted) {
        suffix = ` · ${t("marketplace.contacts.statusAccountDeleted")}`;
      } else if (alreadySuggested) {
        suffix = ` · ${t("marketplace.jobs.alreadySuggested")}`;
      } else if (c.requests_off) {
        suffix = ` · ${t("marketplace.contacts.requestsOffReason")}`;
      }

      return {
        value: c.contact_id,
        disabled: alreadySuggested || c.account_deleted,
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

  const country = job.opening.employing_country
    ? t(`countries.${job.opening.employing_country}`, {
        defaultValue: job.opening.employing_country,
      })
    : "";
  const workArrangement = (jobContent?.work_arrangement as string) || "";
  const employmentType = (jobContent?.employment_type as string) || "";

  const previewSubtitle = [
    opening.client,
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

  const close = () => {
    setSelectedContactId(undefined);
    onClose();
  };

  const handleSuggest = async () => {
    if (selectedContact === undefined) return;
    try {
      await sendMessage.mutateAsync({
        request: {
          contact_id: selectedContact.contact_id,
          suggestion: opening.suggestion,
        },
        key: suggestKey.current(),
      });
      suggestKey.rotate();
      message.success(t("marketplace.jobs.suggestSuccess"));
      onSuccess?.();
      close();
    } catch (error) {
      if (isDefiniteRefusal(error)) suggestKey.rotate();
      const problem = chatRequestProblem(error);
      message.error(
        problem === undefined
          ? t("marketplace.jobs.suggestError")
          : t(`marketplace.chatRequests.problems.${problem}`),
      );
    }
  };

  const checking =
    selectedContact?.has_conversation === true && conversationQuery.isFetching;

  return (
    <>
      <Modal
        open={open}
        onCancel={close}
        title={t("marketplace.jobs.suggestToContactModalTitle")}
        footer={[
          <Button key="cancel" onClick={close}>
            {t("actions.cancel")}
          </Button>,
          mayWrite || selectedContact === undefined || checking ? (
            <Button
              key="suggest"
              type="primary"
              icon={<SendOutlined />}
              loading={sendMessage.isPending || checking}
              disabled={selectedContact === undefined}
              onClick={() => void handleSuggest()}
            >
              {t("marketplace.jobs.sendSuggestion")}
            </Button>
          ) : (
            <Button
              key="request"
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => {
                setRequestFor(selectedContact.contact_id);
                close();
              }}
            >
              {t("marketplace.chatRequests.sendButton")}
            </Button>
          ),
        ]}
        width={560}
        destroyOnHidden
      >
        <Flex vertical gap="middle" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("marketplace.jobs.contactFieldLabel")}
            required
            style={{ marginBottom: 0 }}
          >
            <Select
              showSearch={{
                filterOption: (input, option) => {
                  const c = contacts.find(
                    (item) => item.contact_id === option?.value,
                  );
                  if (!c) return false;
                  const q = input.toLowerCase();
                  return (
                    c.display_name.toLowerCase().includes(q) ||
                    c.handle.toLowerCase().includes(q)
                  );
                },
              }}
              placeholder={t("marketplace.jobs.selectContactPlaceholder")}
              aria-label={t("marketplace.jobs.contactFieldLabel")}
              value={selectedContactId}
              onChange={setSelectedContactId}
              options={contactOptions}
              style={{ width: "100%" }}
            />
          </Form.Item>

          {selectedContact !== undefined && !mayWrite && !checking && (
            <Alert
              type="info"
              showIcon
              title={t("marketplace.jobs.requestInstead", {
                name: selectedContact.display_name,
              })}
            />
          )}

          <div>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 13, display: "block", marginBottom: 8 }}
            >
              {t("marketplace.jobs.whatTheyReceive")}
            </Typography.Text>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Flex align="center" gap="middle">
                <Avatar
                  shape="square"
                  size={40}
                  style={{ backgroundColor: "#fa8c16", fontWeight: 600 }}
                >
                  {getInitials(opening.client)}
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
      <SendChatRequestModal
        open={requestFor !== undefined}
        onClose={() => {
          setRequestFor(undefined);
          onSuccess?.();
        }}
        person={{ contactId: requestFor ?? "" }}
        opening={opening}
      />
    </>
  );
}
