import { MessageOutlined } from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Input,
  message,
  Row,
  Space,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { paths } from "../app/paths";
import { getInitials } from "../features/marketplace/presentation";
import {
  useAddPersonNoteMutation,
  useViewHubProfileQuery,
} from "../features/marketplace/queries";
import { SendChatRequestModal } from "../features/marketplace/SendChatRequestModal";

export function NewContactPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const address = searchParams.get("address") ?? "";

  const noteKey = useIdempotencyKey("new-contact-note");

  const [noteText, setNoteText] = useState("");
  const [requestModalOpen, setRequestModalOpen] = useState(false);

  const profileQuery = useViewHubProfileQuery(address);
  const profileData = profileQuery.data;
  const pub = profileData?.profile;

  const addNoteMutation = useAddPersonNoteMutation();

  const firstName = pub?.display_name
    ? pub.display_name.split(/\s+/)[0]
    : t("marketplace.contacts.personFallback");

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      const res = await addNoteMutation.mutateAsync({
        request: {
          address,
          text: noteText.trim(),
        },
        key: noteKey.current(),
      });
      message.success(t("marketplace.contacts.noteAddedSuccess"));
      if (res?.contact?.contact_id) {
        navigate(paths.contactDetail(res.contact.contact_id));
      } else {
        navigate(paths.contacts);
      }
    } catch {
      message.error(t("marketplace.contacts.noteAddedError"));
    }
  };

  if (!address.trim()) {
    return (
      <Card>
        <Typography.Text type="secondary">
          {t("marketplace.contacts.noAddressProvided")}
        </Typography.Text>
      </Card>
    );
  }

  if (profileQuery.isLoading) {
    return <Card loading style={{ width: "100%" }} />;
  }

  if (profileQuery.isError || !pub) {
    return (
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <Breadcrumb
          items={[
            {
              title: (
                <Link to={paths.contacts}>
                  {t("marketplace.contacts.title")}
                </Link>
              ),
            },
            { title: t("marketplace.contacts.newContactTitle") },
          ]}
        />
        <Alert
          type="error"
          showIcon
          title={t("marketplace.contacts.hubUserNotFoundTitle")}
          description={t("marketplace.contacts.hubUserNotFoundDescription", {
            address,
          })}
        />
      </Space>
    );
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.contacts}>{t("marketplace.contacts.title")}</Link>
            ),
          },
          { title: t("marketplace.contacts.newContactTitle") },
        ]}
      />

      {profileData.contact && (
        <Alert
          type="info"
          showIcon
          title={t("marketplace.contacts.alreadyInContactsNotice")}
          action={
            <Button
              size="small"
              type="primary"
              onClick={() => {
                if (profileData.contact) {
                  navigate(paths.contactDetail(profileData.contact.contact_id));
                }
              }}
            >
              {t("marketplace.contacts.viewContactDetail")}
            </Button>
          }
        />
      )}

      <div>
        <Flex align="center" gap="small" wrap="wrap">
          <Typography.Title level={2} style={{ margin: 0 }}>
            {pub.display_name}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 18 }}>
            @{pub.handle}
          </Typography.Text>
        </Flex>
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
          {[
            pub.work_experiences[0]
              ? `${pub.work_experiences[0].job_title} at ${pub.work_experiences[0].employer_domain}`
              : "",
            pub.resident_country
              ? t(`countries.${pub.resident_country}`, {
                  defaultValue: pub.resident_country,
                })
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography.Paragraph>
      </div>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <Flex justify="space-between" align="center">
                <span>{t("marketplace.contacts.profileTabTitle")}</span>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: "normal" }}
                >
                  {t("marketplace.contacts.liveAsHubUsersSeeIt")}
                </Typography.Text>
              </Flex>
            }
          >
            <Flex vertical gap="large">
              <Flex align="center" gap="middle">
                <Avatar
                  size={64}
                  style={{ backgroundColor: "#1677ff", fontSize: 24 }}
                >
                  {getInitials(pub.display_name)}
                </Avatar>
                <div>
                  <Typography.Text
                    strong
                    style={{ fontSize: 16, display: "block" }}
                  >
                    {pub.display_name}
                  </Typography.Text>
                  {pub.work_experiences[0] && (
                    <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                      {pub.work_experiences[0].job_title} at{" "}
                      {pub.work_experiences[0].employer_domain}
                    </Typography.Text>
                  )}
                </div>
              </Flex>

              <Descriptions column={1} size="small">
                {pub.resident_country && (
                  <Descriptions.Item
                    label={t("marketplace.contacts.residentCountry")}
                  >
                    {t(`countries.${pub.resident_country}`, {
                      defaultValue: pub.resident_country,
                    })}
                  </Descriptions.Item>
                )}
                {pub.work_experiences && pub.work_experiences.length > 0 && (
                  <Descriptions.Item
                    label={t("marketplace.contacts.workExperience")}
                  >
                    <Flex vertical gap="small">
                      {pub.work_experiences.map((w) => (
                        <div key={w.id}>
                          <Typography.Text strong>
                            {w.job_title} · {w.employer_domain}
                          </Typography.Text>
                          <div>
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              {w.start_month} —{" "}
                              {w.end_month ?? t("marketplace.contacts.present")}
                            </Typography.Text>
                          </div>
                        </div>
                      ))}
                    </Flex>
                  </Descriptions.Item>
                )}
                {pub.educational_qualifications &&
                  pub.educational_qualifications.length > 0 && (
                    <Descriptions.Item
                      label={t("marketplace.contacts.education")}
                    >
                      <Flex vertical gap="small">
                        {pub.educational_qualifications.map((e) => (
                          <div key={e.id}>
                            <Typography.Text strong>
                              {e.degree} · {e.institution_domain}
                            </Typography.Text>
                            <div>
                              <Typography.Text
                                type="secondary"
                                style={{ fontSize: 12 }}
                              >
                                {e.start_month ?? ""} —{" "}
                                {e.end_month ??
                                  t("marketplace.contacts.present")}
                              </Typography.Text>
                            </div>
                          </div>
                        ))}
                      </Flex>
                    </Descriptions.Item>
                  )}
                {pub.language_abilities &&
                  pub.language_abilities.length > 0 && (
                    <Descriptions.Item
                      label={t("marketplace.contacts.languages")}
                    >
                      {pub.language_abilities
                        .map((l) => `${l.language_tag} (${l.ability})`)
                        .join(", ")}
                    </Descriptions.Item>
                  )}
                {pub.websites && pub.websites.length > 0 && (
                  <Descriptions.Item label={t("marketplace.contacts.websites")}>
                    {pub.websites.map((ws) => (
                      <div key={ws.id}>
                        <a
                          href={ws.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {ws.url}
                        </a>
                      </div>
                    ))}
                  </Descriptions.Item>
                )}
                {pub.biography && (
                  <Descriptions.Item label={t("marketplace.contacts.bio")}>
                    <Typography.Paragraph
                      style={{ whiteSpace: "pre-line", margin: 0 }}
                    >
                      {pub.biography}
                    </Typography.Paragraph>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Flex>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Space orientation="vertical" size="large" style={{ width: "100%" }}>
            <Card title={t("marketplace.contacts.notesCardTitle")}>
              <Flex vertical gap="small">
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {t("marketplace.contacts.noNotesExplainer", {
                    name: firstName,
                  })}
                </Typography.Text>
                <Input.TextArea
                  rows={4}
                  maxLength={5000}
                  showCount
                  placeholder={t("marketplace.contacts.notePlaceholder")}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("marketplace.contacts.notesPrivacySubtitle", {
                    name: firstName,
                  })}
                </Typography.Text>
                <Flex justify="flex-end" orientation="horizontal">
                  <Button
                    type="primary"
                    disabled={!noteText.trim()}
                    loading={addNoteMutation.isPending}
                    onClick={handleAddNote}
                  >
                    {t("marketplace.contacts.addNote")}
                  </Button>
                </Flex>
              </Flex>
            </Card>

            <Card title={t("marketplace.chatRequests.cardTitle")}>
              <Flex vertical gap="middle">
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {t("marketplace.chatRequests.profileExplainer", {
                    name: firstName,
                  })}
                </Typography.Text>
                <Button
                  icon={<MessageOutlined />}
                  onClick={() => setRequestModalOpen(true)}
                >
                  {t("marketplace.chatRequests.sendButton")}
                </Button>
              </Flex>
            </Card>
          </Space>
        </Col>
      </Row>

      <SendChatRequestModal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        person={
          profileData?.contact === undefined
            ? { address }
            : { contactId: profileData.contact.contact_id }
        }
      />
    </Space>
  );
}
