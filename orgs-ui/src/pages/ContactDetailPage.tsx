import { MessageOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Flex,
  Row,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { isHubHandle } from "typespec/hub/types";
import type { CreditedApplicationSummary } from "typespec/orgs/marketplace/attribution";
import type {
  AgencyProfile,
  Contact,
  ContactOpeningSuggestion,
} from "typespec/orgs/marketplace/contacts/contacts";
import { paths } from "../app/paths";
import {
  countryName,
  useMonthFormat,
} from "../features/applications/presentation";
import { ProfileDescriptions } from "../features/applications/SnapshotCard";
import { ContactConversation } from "../features/marketplace/ContactConversation";
import { ContactNotes } from "../features/marketplace/ContactNotes";
import {
  contactStatusColors,
  contactStatusLabel,
  hubStatusColors,
  hubStatusLabel,
  referralRouteColors,
  referralRouteLabel,
} from "../features/marketplace/presentation";
import {
  useContactQuery,
  useCreditedApplicationsQuery,
  useViewHubProfileQuery,
} from "../features/marketplace/queries";
import { SendChatRequestModal } from "../features/marketplace/SendChatRequestModal";

type PersonTab =
  | "conversation"
  | "notes"
  | "profile"
  | "suggested_openings"
  | "credited_applications";

function NotFound({ address }: { address: string }) {
  const { t } = useTranslation();
  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.contacts}>{t("marketplace.contacts.title")}</Link>
            ),
          },
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

/** An alias opens the person's page by their handle, which never changes. */
function AliasRedirect({ address }: { address: string }) {
  const profileQuery = useViewHubProfileQuery(address);
  if (profileQuery.isLoading) return <Card loading />;
  const handle = profileQuery.data?.profile.handle;
  if (handle === undefined) return <NotFound address={address} />;
  return <Navigate replace to={paths.contactDetail(handle)} />;
}

function ProfileTab({
  profile,
  name,
}: {
  profile: AgencyProfile | undefined;
  name: string;
}) {
  const { t } = useTranslation();
  const month = useMonthFormat();
  if (profile === undefined) {
    return (
      <Typography.Text type="secondary">
        {t("marketplace.contacts.profileUnavailable")}
      </Typography.Text>
    );
  }
  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={15}>
        <Card
          title={t("marketplace.contacts.profileTabTitle")}
          extra={
            <Typography.Text type="secondary">
              {t("marketplace.contacts.liveAsHubUsersSeeIt")}
            </Typography.Text>
          }
        >
          <ProfileDescriptions profile={profile.profile} />
        </Card>
      </Col>
      <Col xs={24} lg={9}>
        <Card title={t("marketplace.contacts.verifiedEmailsTitle")}>
          <Typography.Paragraph type="secondary">
            {t("marketplace.contacts.verifiedEmailsExplainer", { name })}
          </Typography.Paragraph>
          <Table
            size="small"
            pagination={false}
            dataSource={profile.verified_domains}
            rowKey={(domain) => domain.domain}
            locale={{ emptyText: t("marketplace.contacts.noVerifiedDomains") }}
            columns={[
              {
                title: t("marketplace.contacts.domainColumn"),
                key: "domain",
                render: (_, domain) => domain.domain,
              },
              {
                title: t("marketplace.contacts.firstVerifiedColumn"),
                key: "first",
                render: (_, domain) => month(domain.first_verified_month),
              },
              {
                title: t("marketplace.contacts.lastVerifiedColumn"),
                key: "last",
                render: (_, domain) => month(domain.last_verified_month),
              },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}

function SuggestedOpeningsTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const columns: ColumnsType<ContactOpeningSuggestion> = [
    {
      title: t("marketplace.jobs.tableOpening"),
      key: "opening",
      render: (_, item) =>
        t("marketplace.chatRequests.openingLine", {
          client: item.consumer_domain,
          number: item.opening_number,
        }),
    },
    {
      title: t("marketplace.jobs.suggestedDate"),
      key: "suggested_at",
      render: (_, item) => date(item.suggested_at),
    },
  ];
  return (
    <Table<ContactOpeningSuggestion>
      rowKey={(item) => `${item.consumer_domain}-${item.opening_number}`}
      columns={columns}
      dataSource={contact.suggested_openings}
      pagination={false}
      locale={{ emptyText: t("marketplace.contacts.noSuggestedOpenings") }}
    />
  );
}

function CreditedTab({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const creditedQuery = useCreditedApplicationsQuery({
    contact_handle: handle,
  });
  const columns: ColumnsType<CreditedApplicationSummary> = [
    {
      title: t("marketplace.attribution.tableClient"),
      key: "client",
      render: (_, item) => item.client.display_name || item.client.domain,
    },
    {
      title: t("marketplace.attribution.tableOpening"),
      key: "opening",
      render: (_, item) => `#${item.opening.number} ${item.opening.title}`,
    },
    {
      title: t("marketplace.attribution.tableRoute"),
      key: "route",
      render: (_, item) => (
        <Tag color={referralRouteColors[item.route] ?? "default"}>
          {referralRouteLabel(t, item.route)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.attribution.tableStatus"),
      key: "status",
      render: (_, item) => (
        <Tag color={hubStatusColors[item.status] ?? "default"}>
          {hubStatusLabel(t, item.status)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.attribution.tableApplied"),
      key: "applied_at",
      render: (_, item) => date(item.applied_at),
    },
  ];
  return (
    <Table<CreditedApplicationSummary>
      rowKey={(item) =>
        `${item.engagement_id}-${item.opening.number}-${item.application_number}`
      }
      columns={columns}
      dataSource={creditedQuery.data?.items ?? []}
      loading={creditedQuery.isFetching}
      pagination={false}
      scroll={{ x: "max-content" }}
      locale={{ emptyText: t("marketplace.contacts.noCreditedApplications") }}
    />
  );
}

/** One page per person (MKT-UI-008), whether or not the agency has a
 * Contact on them yet. */
function PersonPage({ handle }: { handle: string }) {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requesting, setRequesting] = useState(false);

  const contactQuery = useContactQuery(handle);
  const profileQuery = useViewHubProfileQuery(handle);
  const contact = contactQuery.data;
  const profile = profileQuery.data;

  if (
    contactQuery.isLoading ||
    (contact === undefined && profileQuery.isLoading)
  ) {
    return <Card loading />;
  }
  if (contact === undefined && profile === undefined) {
    return <NotFound address={handle} />;
  }

  const name = contact?.display_name ?? profile?.profile.display_name ?? "";
  const firstName = name.split(/\s+/)[0] ?? name;
  const latestWork = profile?.profile.work_experiences[0];
  const headline = [
    latestWork === undefined
      ? ""
      : t("marketplace.contacts.headline", {
          title: latestWork.job_title,
          employer: latestWork.employer_domain,
        }),
    profile === undefined
      ? ""
      : countryName(i18n.language, profile.profile.resident_country),
  ]
    .filter(Boolean)
    .join(" · ");

  const showConversation =
    contact !== undefined &&
    (contact.has_conversation || contact.latest_request !== undefined);
  const tabs: { key: PersonTab; label: string; children: ReactNode }[] = [
    ...(showConversation && contact !== undefined
      ? [
          {
            key: "conversation" as const,
            label: t("marketplace.contacts.tabConversation"),
            children: (
              <ContactConversation
                contact={contact}
                onRequestChat={() => setRequesting(true)}
              />
            ),
          },
        ]
      : []),
    {
      key: "notes",
      label:
        contact === undefined
          ? t("marketplace.contacts.tabNotes")
          : t("marketplace.contacts.tabWithCount", {
              tab: t("marketplace.contacts.tabNotes"),
              count: contact.note_count,
            }),
      children: (
        <ContactNotes
          handle={handle}
          name={firstName}
          isContact={contact !== undefined}
        />
      ),
    },
    {
      key: "profile",
      label: t("marketplace.contacts.tabProfile"),
      children: <ProfileTab profile={profile} name={firstName} />,
    },
    ...(contact === undefined
      ? []
      : [
          {
            key: "suggested_openings" as const,
            label: t("marketplace.contacts.tabWithCount", {
              tab: t("marketplace.contacts.tabSuggestedOpenings"),
              count: contact.suggested_openings.length,
            }),
            children: <SuggestedOpeningsTab contact={contact} />,
          },
          {
            key: "credited_applications" as const,
            label: t("marketplace.contacts.tabWithCount", {
              tab: t("marketplace.contacts.tabCreditedApplications"),
              count: contact.credited_count,
            }),
            children: <CreditedTab handle={handle} />,
          },
        ]),
  ];
  const requested = searchParams.get("tab");
  const activeTab =
    tabs.find((tab) => tab.key === requested)?.key ??
    (showConversation ? "conversation" : "notes");

  const partyDeleted = contact?.account_deleted === true;
  // A pending request in either direction is answered or awaited on the
  // Conversation tab; an open conversation needs no request.
  const mayRequest =
    !partyDeleted &&
    contact?.status !== "request_received" &&
    contact?.status !== "request_sent" &&
    contact?.status !== "in_conversation";

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.contacts}>{t("marketplace.contacts.title")}</Link>
            ),
          },
          { title: name },
        ]}
      />

      <Flex justify="space-between" align="flex-start" wrap="wrap" gap="middle">
        <div>
          <Flex align="center" gap="small" wrap="wrap">
            <Typography.Title level={1} style={{ margin: 0 }}>
              {name}
            </Typography.Title>
            <Typography.Text type="secondary">@{handle}</Typography.Text>
            {contact !== undefined &&
              (partyDeleted ? (
                <Tag color="error">
                  {t("marketplace.contacts.statusAccountDeleted")}
                </Tag>
              ) : (
                <Tag color={contactStatusColors[contact.status]}>
                  {contactStatusLabel(t, contact.status)}
                </Tag>
              ))}
            {contact?.requests_off === true && !partyDeleted && (
              <Tag color="warning">
                {t("marketplace.contacts.statusRequestsOff")}
              </Tag>
            )}
          </Flex>
          {headline !== "" && (
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {headline}
            </Typography.Paragraph>
          )}
          {contact === undefined && (
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t("marketplace.contacts.notInContacts", { name: firstName })}
            </Typography.Paragraph>
          )}
        </div>
        {mayRequest && (
          <Button
            type="primary"
            icon={<MessageOutlined />}
            onClick={() => setRequesting(true)}
          >
            {t("marketplace.chatRequests.sendButton")}
          </Button>
        )}
      </Flex>

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", key);
            setSearchParams(next, { replace: true });
          }}
          items={tabs}
        />
      </Card>

      <SendChatRequestModal
        open={requesting}
        onClose={() => setRequesting(false)}
        person={{ handle }}
      />
    </Space>
  );
}

export function ContactDetailPage() {
  const { address = "" } = useParams();
  if (!isHubHandle(address)) return <AliasRedirect address={address} />;
  return <PersonPage key={address} handle={address} />;
}
