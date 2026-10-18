import {
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EnvironmentOutlined,
  FilePdfOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  VideoCameraOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Flex,
  Form,
  Grid,
  Input,
  Modal,
  Radio,
  Row,
  Segmented,
  Select,
  Steps,
  Switch,
  Tag,
  Typography,
} from "antd";
import type { ReactNode } from "react";
import {
  AGENCIES,
  CONSUMER,
  HubStatusTag,
  OPENING,
  OpeningContent,
  OrgLogo,
  PersonAvatar,
  ProviderNotice,
} from "./common";
import { SuggestionCard } from "./orgs-provider";
import { HubShell, PageHeader } from "../shell";

const { Text, Paragraph, Link, Title } = Typography;
const GOLD = "#ca8a04";

function OrgLine() {
  return (
    <Flex gap="small" align="center">
      <OrgLogo name={CONSUMER.name} color={GOLD} size={24} />
      <Text type="secondary">
        {CONSUMER.name} · {CONSUMER.domain}
      </Text>
    </Flex>
  );
}

/* ---------- Opening page with Apply (HP-APP) ---------- */

export function HubOpeningApply() {
  return (
    <HubShell selected="home">
      <PageHeader
        crumbs={[CONSUMER.name, OPENING.title]}
        title={OPENING.title}
        intro={<OrgLine />}
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Card>
            <OpeningContent />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Flex orientation="vertical" gap="middle">
            <Card>
              <Flex orientation="vertical" gap="small">
                <Button type="primary" size="large" block>
                  Apply
                </Button>
                <Text type="secondary">
                  {CONSUMER.name} sees your profile as it is when you apply, and
                  a cover note if you add one.
                </Text>
              </Flex>
            </Card>
            <Alert
              type="info"
              showIcon
              title="Northstar Talent suggested this Opening to you"
              description={
                <>
                  On Oct 1 in <Link>your conversation</Link>. You can credit
                  them when you apply.
                </>
              }
            />
            <Card size="small">
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "p", label: "Published", children: "Sep 2, 2026" },
                  { key: "r", label: "Updated", children: "Sep 30, 2026" },
                ]}
              />
            </Card>
          </Flex>
        </Col>
      </Row>
    </HubShell>
  );
}

export function HubApply({ refused = false }: { refused?: boolean }) {
  return (
    <HubShell selected="home">
      <PageHeader
        crumbs={[CONSUMER.name, OPENING.title, "Apply"]}
        title="Apply"
        intro={
          <>
            {OPENING.title} · {CONSUMER.name}
          </>
        }
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Flex orientation="vertical" gap="middle">
            <Card
              title={`What ${CONSUMER.name} will see`}
              extra={<Link>Edit my profile</Link>}
            >
              <Flex gap="middle" align="center" style={{ marginBottom: 12 }}>
                <PersonAvatar name="Arun Kumar Pillai" size={48} />
                <Flex orientation="vertical">
                  <Text strong style={{ fontSize: 16 }}>
                    Arun Kumar Pillai
                  </Text>
                  <Text type="secondary">
                    Product Designer at Grab · Singapore
                  </Text>
                </Flex>
              </Flex>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "w", label: "Work experience", children: "2 roles" },
                  { key: "e", label: "Education", children: "1 entry" },
                  { key: "l", label: "Languages", children: "English, Malay" },
                  { key: "s", label: "Websites", children: "1 link" },
                ]}
              />
              <Paragraph
                type="secondary"
                style={{ marginTop: 8, marginBottom: 0 }}
              >
                They get a copy of your profile as it is now. Later edits don't
                change it. Your picture, email address and professional emails
                are never shared.
              </Paragraph>
            </Card>
            <Card
              title="Cover note"
              extra={<Text type="secondary">Optional</Text>}
            >
              <Input.TextArea
                rows={5}
                showCount
                maxLength={5000}
                placeholder="Why this role, and anything your profile doesn't say."
              />
            </Card>
            <Card title="Referred by">
              <Paragraph type="secondary">
                If an agency helped you find this Opening, choose it and it is
                credited with your application. Choosing no agency is fine.
              </Paragraph>
              <Radio.Group
                value={refused ? "other" : "northstar"}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <Radio value="none">No agency</Radio>
                <Radio value="northstar">
                  <Flex gap="small" align="center">
                    <OrgLogo
                      name="Northstar Talent"
                      color={AGENCIES.northstar.color}
                      size={20}
                    />
                    <Text>Northstar Talent</Text>
                    <Text type="secondary">
                      · suggested this Opening on Oct 1
                    </Text>
                  </Flex>
                </Radio>
                <Radio value="lioncity">
                  <Flex gap="small" align="center">
                    <OrgLogo
                      name="Lion City Search"
                      color={AGENCIES.lioncity.color}
                      size={20}
                    />
                    <Text>Lion City Search</Text>
                    <Text type="secondary">
                      · suggested this Opening on Sep 28
                    </Text>
                  </Flex>
                </Radio>
                <Radio value="other">Another agency</Radio>
              </Radio.Group>
              {refused ? (
                <Form
                  layout="vertical"
                  style={{ marginTop: 12, marginLeft: 24 }}
                >
                  <Form.Item
                    label="Agency's domain"
                    validateStatus="error"
                    help="talentfirst.example isn't an agency working on this Opening. Check the domain, or choose another agency or none."
                  >
                    <Input
                      value="talentfirst.example"
                      style={{ maxWidth: 360 }}
                    />
                  </Form.Item>
                </Form>
              ) : null}
            </Card>
          </Flex>
        </Col>
        <Col xs={24} lg={8}>
          <Card>
            <Flex gap="small" align="center" style={{ marginBottom: 12 }}>
              <OrgLogo name={CONSUMER.name} color={GOLD} size={40} />
              <Flex orientation="vertical">
                <Text strong>{OPENING.title}</Text>
                <Text type="secondary">{CONSUMER.name}</Text>
              </Flex>
            </Flex>
            <Text type="secondary">Singapore · Hybrid · Full time</Text>
            <Divider />
            <Button type="primary" block size="large">
              Submit application
            </Button>
            <Paragraph
              type="secondary"
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              You can apply once to each Opening. You can withdraw later, but
              you can't apply again.
            </Paragraph>
          </Card>
        </Col>
      </Row>
    </HubShell>
  );
}

/* ---------- Applications list (HP-HUB-002) ---------- */

const APPS: {
  title: string;
  org: string;
  color?: string;
  status: string;
  action?: string;
  meta: string;
}[] = [
  {
    title: "Senior product designer",
    org: "Example SGP Gold Corp",
    color: GOLD,
    status: "interviewing",
    action: "Respond to an interview",
    meta: "Applied Oct 2 · Updated today",
  },
  {
    title: "Lead designer, growth",
    org: "Example USA1 Silver Inc",
    status: "offer",
    action: "Respond to the offer by Oct 30",
    meta: "Applied Sep 12 · Updated Oct 16",
  },
  {
    title: "Design systems lead",
    org: "Example DEU GmbH",
    status: "in_review",
    meta: "Applied Oct 10 · Updated Oct 14",
  },
  {
    title: "Product designer, payments",
    org: "Example IND1 Gold Pvt Ltd",
    status: "applied",
    meta: "Applied Oct 17",
  },
];

export function HubApplications() {
  const screens = Grid.useBreakpoint();
  return (
    <HubShell selected="applications">
      <PageHeader
        title="Applications"
        intro="Openings you applied to, where each one stands, and what needs your answer."
      />
      <Segmented
        value="Active (4)"
        options={["Active (4)", "Closed (3)"]}
        style={{ marginBottom: 16, alignSelf: "start" }}
      />
      <Flex orientation="vertical" gap="small">
        {APPS.map((a) => (
          <Card key={a.title} hoverable size="small">
            <Flex
              gap="middle"
              align={screens.md ? "center" : "start"}
              wrap={!screens.md}
            >
              <OrgLogo name={a.org} color={a.color} size={40} />
              <Flex orientation="vertical" style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 16 }}>
                  {a.title}
                </Text>
                <Text type="secondary">{a.org}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {a.meta}
                </Text>
              </Flex>
              <Flex
                orientation="vertical"
                align={screens.md ? "end" : "start"}
                gap={6}
              >
                <HubStatusTag s={a.status} />
                {a.action ? (
                  <Badge
                    status="warning"
                    text={<Text strong>{a.action}</Text>}
                  />
                ) : null}
              </Flex>
            </Flex>
          </Card>
        ))}
      </Flex>
    </HubShell>
  );
}

/* ---------- Application detail (HP-HUB-003/004) ---------- */

function AppDetailFrame({
  status,
  current,
  children,
  modal,
}: {
  status: string;
  current: number;
  children: ReactNode;
  modal?: ReactNode;
}) {
  return (
    <HubShell selected="applications">
      <PageHeader
        crumbs={["Applications", OPENING.title]}
        title={OPENING.title}
        tags={<HubStatusTag s={status} />}
        intro={<OrgLine />}
        extra={<Button danger>Withdraw application</Button>}
      />
      <Card style={{ marginBottom: 16 }}>
        <Steps
          current={current}
          size="small"
          responsive
          items={[
            { title: "Applied", content: "Oct 2" },
            { title: "In review", content: "Oct 4" },
            { title: "Interviewing" },
            { title: "Offer" },
            { title: "Hired" },
          ]}
        />
      </Card>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Flex orientation="vertical" gap="middle">
            {children}
          </Flex>
        </Col>
        <Col xs={24} lg={8}>
          <Flex orientation="vertical" gap="middle">
            <Card title="Your application" size="small">
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "n", label: "Application", children: "#12" },
                  { key: "a", label: "Applied", children: "Oct 2, 2026" },
                  {
                    key: "r",
                    label: "Referred by",
                    children: "Northstar Talent",
                  },
                ]}
              />
              <Link>View what you sent</Link>
            </Card>
            <Card size="small">
              <Text type="secondary">
                {CONSUMER.name} decides how your application moves. You'll get
                an email when something needs your answer.
              </Text>
            </Card>
          </Flex>
        </Col>
      </Row>
      {modal}
    </HubShell>
  );
}

function HubInterview({
  n,
  when,
  mode,
  where,
  state,
  actions,
}: {
  n: number;
  when: string;
  mode: "video" | "in_person";
  where: string;
  state: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card
      size="small"
      title={
        <Flex gap="small" align="center">
          <Text strong>Interview {n}</Text>
          {state}
        </Flex>
      }
    >
      <Flex orientation="vertical" gap="small">
        <Text strong>{when}</Text>
        {mode === "video" ? (
          <Flex gap={6}>
            <VideoCameraOutlined />
            <Link>{where}</Link>
          </Flex>
        ) : (
          <Flex gap={6}>
            <EnvironmentOutlined />
            <Text>{where}</Text>
          </Flex>
        )}
        {actions}
      </Flex>
    </Card>
  );
}

export function HubAppInterview({
  reschedule = false,
}: {
  reschedule?: boolean;
}) {
  return (
    <AppDetailFrame
      status="interviewing"
      current={2}
      modal={
        reschedule ? (
          <Modal
            open
            title="Request another time"
            okText="Send request"
            width={520}
          >
            <Paragraph type="secondary">
              Interview 2 · Mon, Oct 27, 2026, 9:00 AM SGT
            </Paragraph>
            <Form layout="vertical">
              <Form.Item
                label="Note"
                required
                extra="Say which times work for you. Up to 500 characters."
              >
                <Input.TextArea
                  rows={4}
                  showCount
                  maxLength={500}
                  value="Could we do the afternoon? I'm flying back from Jakarta that morning. Anything after 2 PM SGT on Oct 27 or 28 works."
                />
              </Form.Item>
            </Form>
          </Modal>
        ) : undefined
      }
    >
      <Card
        title={
          <Flex gap="small" align="center">
            Interviews <Badge count={1} />
          </Flex>
        }
      >
        <Flex orientation="vertical" gap="small">
          <HubInterview
            n={2}
            when="Mon, Oct 27, 2026, 9:00 AM SGT · 45 minutes"
            mode="in_person"
            where="Marina Bay Financial Centre, Tower 3, 12F"
            state={<Tag color="warning">Needs your answer</Tag>}
            actions={
              <Flex gap="small">
                <Button type="primary" icon={<CheckOutlined />}>
                  Accept
                </Button>
                <Button>Request another time</Button>
              </Flex>
            }
          />
          <HubInterview
            n={1}
            when="Tue, Oct 21, 2026, 10:00 AM SGT · 60 minutes"
            mode="video"
            where="meet.interviewpanel.example/r/8x2k"
            state={<Tag color="success">Accepted</Tag>}
          />
          <ProviderNotice a="panel" what="This interview" />
        </Flex>
      </Card>
    </AppDetailFrame>
  );
}

export function HubAppConsent() {
  return (
    <AppDetailFrame status="in_review" current={1}>
      <Card
        title={
          <Flex gap="small" align="center">
            <SafetyCertificateOutlined />
            Background check consent
          </Flex>
        }
        extra={<Tag color="warning">Needs your answer</Tag>}
      >
        <Paragraph>
          {CONSUMER.name} asks for your consent to these checks:
        </Paragraph>
        <Flex gap="small" wrap style={{ marginBottom: 16 }}>
          {["Identity", "Education", "Employment", "Criminal record"].map(
            (c) => (
              <Tag key={c}>{c}</Tag>
            ),
          )}
        </Flex>
        <ProviderNotice a="verity" what="This background check" />
        <Card
          size="small"
          title="VerityCheck's disclosure"
          style={{ marginTop: 16 }}
        >
          <Paragraph style={{ marginBottom: 0 }}>
            VerityCheck Pvt Ltd will verify the information you provided with
            the institutions, employers and authorities named in your profile,
            as requested by the hiring organization. We keep the evidence for 2
            years and share the results only with the hiring organization. You
            can ask us for a copy of your report at privacy@veritycheck.example.
          </Paragraph>
        </Card>
        <Checkbox checked style={{ marginTop: 16 }}>
          I have read the disclosure and consent to these checks
        </Checkbox>
        <Flex gap="small" style={{ marginTop: 16 }}>
          <Button type="primary">Give consent</Button>
          <Button>Decline</Button>
        </Flex>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          Nothing is checked until you consent. If you decline, {CONSUMER.name}{" "}
          decides what happens next.
        </Paragraph>
      </Card>
    </AppDetailFrame>
  );
}

export function HubAppOffer() {
  return (
    <AppDetailFrame status="offer" current={3}>
      <Card
        title="Your offer"
        extra={<Tag color="warning">Respond by Oct 30, 2026</Tag>}
      >
        <Flex gap="middle" align="center" style={{ marginBottom: 16 }}>
          <FilePdfOutlined style={{ fontSize: 32, color: "#dc2626" }} />
          <Flex orientation="vertical" style={{ flex: 1 }}>
            <Text strong>Offer letter - Arun Kumar Pillai.pdf</Text>
            <Text type="secondary">214 KB · Sent Oct 16, 2026</Text>
          </Flex>
          <Button icon={<DownloadOutlined />}>Download</Button>
        </Flex>
        <Descriptions
          size="small"
          column={1}
          items={[
            {
              key: "j",
              label: "Proposed joining date",
              children: "Dec 1, 2026",
            },
            {
              key: "d",
              label: "Respond by",
              children: "Oct 30, 2026 (12 days left)",
            },
          ]}
        />
        <Alert
          type="info"
          showIcon
          style={{ margin: "16px 0" }}
          title="If you don't answer by Oct 30, the offer is declined automatically."
        />
        <Flex gap="small">
          <Button type="primary" size="large">
            Accept offer
          </Button>
          <Button size="large">Decline</Button>
        </Flex>
      </Card>
    </AppDetailFrame>
  );
}

/* ---------- Messages (MKT-HUB-001) ---------- */

const CONVS = [
  {
    a: "northstar" as const,
    last: "Looks interesting. Is the team open to someone…",
    when: "11:02 AM",
    unread: 0,
  },
  {
    a: "lioncity" as const,
    last: "Opening suggestion: Senior product designer",
    when: "Sep 28",
    unread: 1,
  },
  {
    a: "meridian" as const,
    last: "Thanks for getting back to me, Arun.",
    when: "Aug 4",
    unread: 0,
  },
];

function ConvList({ selected }: { selected?: string }) {
  return (
    <Card styles={{ body: { padding: 0 } }}>
      {CONVS.map((c) => (
        <Flex
          key={c.a}
          gap="middle"
          align="center"
          style={{
            padding: 14,
            borderBottom: "1px solid rgba(127,127,127,0.15)",
            background: c.a === selected ? "rgba(37,99,235,0.08)" : undefined,
          }}
        >
          <OrgLogo
            name={AGENCIES[c.a].name}
            color={AGENCIES[c.a].color}
            size={40}
          />
          <Flex orientation="vertical" style={{ flex: 1, minWidth: 0 }}>
            <Flex justify="space-between">
              <Text strong={c.unread > 0}>{AGENCIES[c.a].name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {c.when}
              </Text>
            </Flex>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {AGENCIES[c.a].domain}
            </Text>
            <Flex justify="space-between" gap="small">
              <Text type="secondary" ellipsis>
                {c.last}
              </Text>
              {c.unread ? <Badge count={c.unread} /> : null}
            </Flex>
          </Flex>
        </Flex>
      ))}
    </Card>
  );
}

function Bubble({
  mine,
  who,
  when,
  children,
}: {
  mine: boolean;
  who: string;
  when: string;
  children: ReactNode;
}) {
  return (
    <Flex orientation="vertical" align={mine ? "end" : "start"} gap={2}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {who} · {when}
      </Text>
      <div
        className="chat-bubble"
        style={{
          background: mine ? "#2563eb" : "rgba(127,127,127,0.12)",
          color: mine ? "#fff" : undefined,
        }}
      >
        {children}
      </div>
    </Flex>
  );
}

function Thread({
  unavailable = false,
  back = false,
}: {
  unavailable?: boolean;
  back?: boolean;
}) {
  const a = unavailable ? AGENCIES.lioncity : AGENCIES.northstar;
  return (
    <Card
      title={
        <Flex gap="small" align="center">
          {back ? <Button type="text" icon={<ArrowLeftOutlined />} /> : null}
          <OrgLogo name={a.name} color={a.color} size={28} />
          <Flex orientation="vertical">
            <Text strong>{a.name}</Text>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              {a.domain} · Agency
            </Text>
          </Flex>
        </Flex>
      }
      extra={
        <Button type="text" danger icon={<DeleteOutlined />}>
          {back ? null : "Delete"}
        </Button>
      }
    >
      {unavailable ? (
        <Alert
          type="warning"
          showIcon
          title="We couldn't load this conversation"
          description="Lion City Search's region didn't answer. Your messages are safe; try again in a moment."
          action={<Button icon={<ReloadOutlined />}>Try again</Button>}
        />
      ) : (
        <>
          <Flex
            orientation="vertical"
            gap="middle"
            style={{ marginBottom: 16 }}
          >
            <Bubble mine={false} who="Rachel Kim" when="Sep 28, 10:14 AM">
              Hi Arun — I'm Rachel at Northstar Talent. We work with a few
              design-led companies in Singapore. Your merchant onboarding work
              at Grab caught my eye. Open to hearing about senior roles?
            </Bubble>
            <Bubble mine who="You" when="Sep 29, 8:40 PM">
              Thanks Rachel. I'm happy where I am but would consider the right
              senior role, especially hybrid.
            </Bubble>
            <Bubble mine={false} who="Daniel Ortiz" when="Oct 1, 9:02 AM">
              Here's one that fits — hybrid, Marina Bay, design lead for the
              candidate experience.
            </Bubble>
            <SuggestionCard />
            <Bubble mine who="You" when="Today, 11:02 AM">
              Looks interesting. Is the team open to someone who has mostly
              worked on payments?
            </Bubble>
          </Flex>
          <Input.TextArea
            rows={3}
            placeholder="Write a reply"
            showCount
            maxLength={5000}
            style={{ marginBottom: 20 }}
          />
          <Flex justify="space-between" align="center" style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Agencies never see your email address.
            </Text>
            <Button type="primary" icon={<SendOutlined />}>
              Send
            </Button>
          </Flex>
        </>
      )}
    </Card>
  );
}

export function HubMessages({
  unavailable = false,
}: {
  unavailable?: boolean;
}) {
  const screens = Grid.useBreakpoint();
  return (
    <HubShell selected="messages">
      <PageHeader
        title="Messages"
        intro="Agencies that contacted you about Openings. Reply, or delete a conversation to remove it for both of you."
      />
      {screens.lg ? (
        <Row gutter={16}>
          <Col span={9}>
            <ConvList selected={unavailable ? "lioncity" : "northstar"} />
          </Col>
          <Col span={15}>
            <Thread unavailable={unavailable} />
          </Col>
        </Row>
      ) : (
        <Thread unavailable={unavailable} back />
      )}
    </HubShell>
  );
}

export function HubMessagesListPhone() {
  return (
    <HubShell selected="messages">
      <PageHeader
        title="Messages"
        intro="Agencies that contacted you about Openings."
      />
      <ConvList />
    </HubShell>
  );
}

/* ---------- Settings (MKT-HUB-002, MKT-PRF-004) ---------- */

export function HubPreferences() {
  return (
    <HubShell selected="prefs">
      <PageHeader
        title="Preferences"
        intro="Choose how Vetchium works for you. Only you can see these."
      />
      <Flex orientation="vertical" gap="middle">
        <Card title="Display language">
          <Form layout="vertical">
            <Form.Item
              label="Language"
              extra="Used for this portal and for the emails Vetchium sends you."
              style={{ maxWidth: 520 }}
            >
              <Select
                value="en"
                options={[{ value: "en", label: "English (United States)" }]}
              />
            </Form.Item>
          </Form>
        </Card>
        <Card title="Job search">
          <Form layout="vertical">
            <Form.Item
              label="Preferred job countries"
              style={{ maxWidth: 520 }}
            >
              <Select
                mode="multiple"
                value={["SG"]}
                options={[{ value: "SG", label: "Singapore" }]}
              />
            </Form.Item>
          </Form>
        </Card>
        <Card title="Agency messages">
          <Flex gap="middle" align="start">
            <Switch checked />
            <Flex orientation="vertical" gap={4}>
              <Text strong>Agencies may message me</Text>
              <Text type="secondary">
                Recruitment agencies on Vetchium can start a conversation with
                you and suggest Openings. They never see your email address.
              </Text>
              <Text type="secondary">
                Turning this off makes all your agency conversations read-only
                and stops new ones. Agencies can still view your profile.
              </Text>
            </Flex>
          </Flex>
        </Card>
      </Flex>
    </HubShell>
  );
}

export function HubWorkEmails() {
  return (
    <HubShell selected="workemails">
      <PageHeader
        title="Professional emails"
        intro="Prove that you control an address at a place you work or worked. Verification does not confirm your job title or employment dates."
      />
      <Card
        title="Your addresses"
        extra={
          <Button type="primary" icon={<PlusOutlined />}>
            Add email
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="What agencies see"
          description="Agencies that view your profile see each verified domain with the month and year you first and last verified it — for example grab.com, Mar 2023 – Oct 2026. They never see the addresses."
        />
        {[
          ["arun.pillai@grab.com", "Verified · last Oct 2026"],
          ["arun@foodpanda.sg", "Verified · last Feb 2021"],
        ].map(([e, s]) => (
          <Flex
            key={e}
            justify="space-between"
            align="center"
            style={{
              padding: "10px 0",
              borderBottom: "1px solid rgba(127,127,127,0.15)",
            }}
          >
            <Text>{e}</Text>
            <Tag color="success">{s}</Tag>
          </Flex>
        ))}
      </Card>
    </HubShell>
  );
}

export function HubHome() {
  return (
    <HubShell selected="home">
      <PageHeader title="Welcome back, Arun Kumar Pillai" />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <Flex gap="small" align="center">
                Needs your answer <Badge count={2} />
              </Flex>
            }
            extra={<Link>All applications</Link>}
          >
            <Flex orientation="vertical" gap="middle">
              {APPS.filter((a) => a.action).map((a) => (
                <Flex key={a.title} gap="middle" align="center">
                  <OrgLogo name={a.org} color={a.color} size={36} />
                  <Flex orientation="vertical" style={{ flex: 1 }}>
                    <Text strong>{a.title}</Text>
                    <Text type="secondary">
                      {a.org} · {a.action}
                    </Text>
                  </Flex>
                  <Button>Open</Button>
                </Flex>
              ))}
            </Flex>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={
              <Flex gap="small" align="center">
                Messages <Badge count={1} />
              </Flex>
            }
            extra={<Link>Open messages</Link>}
          >
            <Flex gap="middle" align="center">
              <OrgLogo
                name="Lion City Search"
                color={AGENCIES.lioncity.color}
                size={36}
              />
              <Flex orientation="vertical">
                <Text strong>Lion City Search</Text>
                <Text type="secondary">Suggested an Opening · Sep 28</Text>
              </Flex>
            </Flex>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Your profile">
            <Text type="secondary">(existing profile card)</Text>
          </Card>
        </Col>
      </Row>
    </HubShell>
  );
}

export { Title };
