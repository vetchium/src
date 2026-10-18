import {
  CheckCircleFilled,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SendOutlined,
  VideoCameraOutlined,
  AimOutlined,
  LockOutlined,
} from "@ant-design/icons";
import {
  Affix,
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
  Input,
  Modal,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ReactNode } from "react";
import {
  AGENCIES,
  Agency,
  CapabilityTag,
  CONSUMER,
  CoverNote,
  EngagementStateTag,
  HubStatusTag,
  OPENING,
  OpeningContent,
  OrgLogo,
  PEOPLE,
  Person,
  PersonAvatar,
  type PersonKey,
  RouteTag,
  SnapshotCard,
} from "./common";
import { OrgsShell, PageHeader } from "../shell";

const { Text, Paragraph, Link, Title } = Typography;

/* ---------- Listings (MKT-UI-003) ---------- */

function ListingCard({
  c,
  state,
  headline,
  body,
  actions,
}: {
  c: string;
  state?: string;
  headline?: string;
  body?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Card
      title={
        <Flex gap="small" align="center">
          <CapabilityTag c={c} />
          {state ? (
            <Tag
              color={
                state === "Listed"
                  ? "success"
                  : state === "Draft"
                    ? "blue"
                    : "default"
              }
            >
              {state}
            </Tag>
          ) : null}
        </Flex>
      }
      actions={[
        <Flex key="a" justify="center" gap="small">
          {actions}
        </Flex>,
      ]}
    >
      {headline ? <Text strong>{headline}</Text> : null}
      <div style={{ marginTop: 8 }}>{body}</div>
    </Card>
  );
}

export function ListingsPage() {
  return (
    <OrgsShell kind="provider" selected="listings">
      <PageHeader
        title="Listings"
        intro="Offer your services to other organizations. Listed services appear in Find providers for every organization on Vetchium."
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <ListingCard
            c="interviewing"
            state="Listed"
            headline="Structured interview panels in English and German"
            body={
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "s", label: "Serves", children: "Worldwide" },
                  { key: "l", label: "Languages", children: "English, German" },
                  {
                    key: "p",
                    label: "Indicative price",
                    children: "EUR 180 per completed interview",
                  },
                  {
                    key: "c",
                    label: "Clients",
                    children: "4 active engagements",
                  },
                ]}
              />
            }
            actions={
              <>
                <Button icon={<EditOutlined />}>Edit</Button>
                <Button>Unlist</Button>
                <Button icon={<EyeOutlined />}>Preview</Button>
              </>
            }
          />
        </Col>
        <Col xs={24} md={12}>
          <ListingCard
            c="assessment"
            state="Draft"
            headline="Take-home design and engineering exercises"
            body={
              <Text type="secondary">
                Not visible to other organizations yet. Add service countries to
                list it.
              </Text>
            }
            actions={
              <>
                <Button type="primary">Continue editing</Button>
                <Button type="text" danger>
                  Delete draft
                </Button>
              </>
            }
          />
        </Col>
        <Col xs={24} md={12}>
          <ListingCard
            c="sourcing"
            body={
              <Text type="secondary">
                Find and suggest candidates for your clients' Openings. Listing
                sourcing makes you an agency: Jobs and Contacts appear in your
                navigation.
              </Text>
            }
            actions={<Button icon={<PlusOutlined />}>Create listing</Button>}
          />
        </Col>
        <Col xs={24} md={12}>
          <ListingCard
            c="background_check"
            body={
              <Text type="secondary">
                Run checks your clients choose, after the candidate consents in
                Vetchium.
              </Text>
            }
            actions={<Button icon={<PlusOutlined />}>Create listing</Button>}
          />
        </Col>
      </Row>
    </OrgsShell>
  );
}

export function ListingsPlanGate() {
  return (
    <OrgsShell kind="consumer" selected="listings">
      <PageHeader
        title="Listings"
        intro="Offer your services to other organizations. Listed services appear in Find providers for every organization on Vetchium."
      />
      <Card>
        <Flex
          orientation="vertical"
          align="center"
          gap="middle"
          style={{ padding: "32px 0", textAlign: "center" }}
        >
          <LockOutlined style={{ fontSize: 40, color: "#2563eb" }} />
          <Title level={3} style={{ margin: 0 }}>
            Listings need the Silver or Gold plan
          </Title>
          <Paragraph type="secondary" style={{ maxWidth: 520 }}>
            Your organization is on the Free plan. Upgrade to offer services to
            other organizations:
          </Paragraph>
          <Flex orientation="vertical" gap={6} align="start">
            {[
              "List sourcing, interviewing, assessment, or background-check services",
              "Appear in Find providers worldwide",
              "Work for clients from your Work queue, and as an agency, message people",
            ].map((t) => (
              <Flex key={t} gap="small">
                <CheckCircleFilled style={{ color: "#16a34a" }} />
                <Text>{t}</Text>
              </Flex>
            ))}
          </Flex>
          <Button type="primary" size="large">
            Compare plans
          </Button>
          <Text type="secondary">
            Engaging providers for your own Openings is available on every plan.
          </Text>
        </Flex>
      </Card>
    </OrgsShell>
  );
}

export function ListingEditor() {
  return (
    <OrgsShell kind="provider" selected="listings">
      <PageHeader
        crumbs={["Listings", "Background check"]}
        title="Background check listing"
        tags={<Tag color="blue">Draft</Tag>}
        intro="Describe the checks you run. Organizations read this before proposing to work with you."
      />
      <Row gutter={24}>
        <Col xs={24} lg={16}>
          <Flex orientation="vertical" gap="middle">
            <Card title="Basics">
              <Form layout="vertical">
                <Form.Item label="Headline" required>
                  <Input
                    value="Fast, consent-first background checks across South Asia"
                    showCount
                    maxLength={200}
                  />
                </Form.Item>
                <Form.Item
                  label="Description"
                  required
                  extra="Markdown works here: headings, lists, bold, italics, and links."
                >
                  <Input.TextArea
                    rows={5}
                    value={
                      "We verify identity, education and employment for 40+ countries.\n\n- Typical turnaround 3–5 working days\n- Reports hosted on our secure portal"
                    }
                  />
                </Form.Item>
              </Form>
            </Card>
            <Card title="Coverage">
              <Form layout="vertical">
                <Form.Item
                  label="Service countries"
                  required
                  extra="Where you can do this work. A declaration only: organizations anywhere may still engage you."
                >
                  <Radio.Group
                    value="countries"
                    options={[
                      { value: "worldwide", label: "Worldwide" },
                      { value: "countries", label: "Selected countries" },
                    ]}
                  />
                  <Select
                    mode="multiple"
                    style={{ marginTop: 8 }}
                    value={["IN", "SG", "AE", "LK", "BD"]}
                    options={[
                      { value: "IN", label: "India" },
                      { value: "SG", label: "Singapore" },
                      { value: "AE", label: "United Arab Emirates" },
                      { value: "LK", label: "Sri Lanka" },
                      { value: "BD", label: "Bangladesh" },
                    ]}
                  />
                </Form.Item>
                <Form.Item label="Languages" extra="Optional. Up to 20.">
                  <Select
                    mode="multiple"
                    value={["en", "hi"]}
                    options={[
                      { value: "en", label: "English" },
                      { value: "hi", label: "Hindi" },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label="Indicative price"
                  extra="Optional plain text shown to organizations. Vetchium never charges or invoices on your behalf."
                >
                  <Input value="From USD 25 per check; volume pricing available" />
                </Form.Item>
              </Form>
            </Card>
            <Card title="Checks and consent">
              <Form layout="vertical">
                <Form.Item label="Check types you perform" required>
                  <Checkbox.Group
                    value={["identity", "education", "employment", "criminal"]}
                    options={[
                      { value: "identity", label: "Identity" },
                      { value: "education", label: "Education" },
                      { value: "employment", label: "Employment" },
                      { value: "criminal", label: "Criminal record" },
                      { value: "address", label: "Address" },
                      { value: "credit", label: "Credit" },
                      { value: "drug", label: "Drug test" },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  label="Consent disclosure"
                  required
                  extra="Shown to each candidate before they consent. A candidate keeps the copy shown when their check was routed to you; later edits apply to new checks only."
                >
                  <Input.TextArea
                    rows={6}
                    showCount
                    maxLength={5000}
                    value={
                      "VerityCheck Pvt Ltd will verify the information you provided with the institutions, employers and authorities named in your profile, as requested by the hiring organization. We keep the evidence for 2 years and share the results only with the hiring organization. You can ask us for a copy of your report at privacy@veritycheck.example."
                    }
                  />
                </Form.Item>
              </Form>
            </Card>
          </Flex>
        </Col>
        <Col xs={24} lg={8}>
          <Affix offsetTop={24}>
            <Card title="Actions">
              <Paragraph type="secondary">
                Listing makes this visible in Find providers in every region.
                You can unlist at any time; active clients continue.
              </Paragraph>
              <Flex orientation="vertical" gap="small">
                <Button type="primary" block>
                  List
                </Button>
                <Button block>Save draft</Button>
              </Flex>
              <Divider />
              <Text strong>Ready to list</Text>
              <Progress percent={100} size="small" />
              <Flex orientation="vertical" gap={4} style={{ marginTop: 8 }}>
                {[
                  "Headline",
                  "Description",
                  "Service countries",
                  "Check types",
                  "Consent disclosure",
                ].map((t) => (
                  <Flex key={t} gap="small">
                    <CheckCircleFilled style={{ color: "#16a34a" }} />
                    <Text>{t}</Text>
                  </Flex>
                ))}
              </Flex>
            </Card>
          </Affix>
        </Col>
      </Row>
    </OrgsShell>
  );
}

/* ---------- Clients (MKT-UI-004) ---------- */

export function ClientsPage() {
  return (
    <OrgsShell kind="provider" selected="clients">
      <PageHeader
        title="Clients"
        intro="Organizations that engaged you. Accept a proposal to start working on the Openings and stages they assign to you."
      />
      <Card
        title={
          <Flex gap="small" align="center">
            Awaiting your decision <Badge count={1} />
          </Flex>
        }
        style={{ marginBottom: 16 }}
      >
        <Card size="small">
          <Flex gap="middle" align="start" wrap>
            <OrgLogo name="Example SGP Gold Corp" color="#ca8a04" size={48} />
            <Flex
              orientation="vertical"
              gap={4}
              style={{ flex: 1, minWidth: 280 }}
            >
              <Flex gap="small" align="center">
                <Text strong style={{ fontSize: 16 }}>
                  {CONSUMER.name}
                </Text>
                <CapabilityTag c="interviewing" />
              </Flex>
              <Text type="secondary">
                {CONSUMER.domain} · Based in Singapore · Proposed Oct 14, 2026 ·
                Expires Nov 13, 2026
              </Text>
              <Card size="small" style={{ marginTop: 8 }}>
                <Text>
                  "We'd like you to run the design panel interviews for our
                  senior product designer Opening — about 8 candidates over the
                  next month."
                </Text>
              </Card>
              <Text type="secondary" style={{ marginTop: 4 }}>
                Their reference: PO-2026-130
              </Text>
            </Flex>
            <Flex gap="small">
              <Button type="primary">Accept</Button>
              <Button>Decline</Button>
            </Flex>
          </Flex>
        </Card>
      </Card>
      <Card>
        <Segmented
          value="Active (4)"
          options={["Active (4)", "Ended (2)", "Declined (1)"]}
          style={{ marginBottom: 16 }}
        />
        <Table
          rowKey="n"
          pagination={false}
          dataSource={[
            {
              n: "Example SGP Gold Corp",
              d: "gold.sgp.example.com",
              c: "interviewing",
              since: "Sep 22, 2026",
              work: 6,
              ref: "IP-SOW-12",
            },
            {
              n: "Example USA1 Silver Inc",
              d: "silver.usa1.example.com",
              c: "interviewing",
              since: "Aug 14, 2026",
              work: 2,
              ref: "IP-SOW-09",
            },
            {
              n: "Example DEU GmbH",
              d: "deu.example.com",
              c: "interviewing",
              since: "Jul 3, 2026",
              work: 11,
              ref: "IP-SOW-04",
            },
            {
              n: "Example IND1 Gold Pvt Ltd",
              d: "gold.ind1.example.com",
              c: "interviewing",
              since: "Jun 20, 2026",
              work: 0,
              ref: "—",
            },
          ]}
          columns={[
            {
              title: "Client",
              key: "n",
              render: (_, r) => (
                <Flex gap="small" align="center">
                  <OrgLogo name={r.n} size={28} />
                  <Flex orientation="vertical">
                    <Link>{r.n}</Link>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {r.d}
                    </Text>
                  </Flex>
                </Flex>
              ),
            },
            {
              title: "Capability",
              key: "c",
              render: (_, r) => <CapabilityTag c={r.c} />,
            },
            {
              title: "State",
              key: "s",
              render: () => <EngagementStateTag s="active" />,
            },
            { title: "Open work", dataIndex: "work", align: "end" },
            { title: "Your reference", dataIndex: "ref" },
            { title: "Since", dataIndex: "since" },
          ]}
        />
      </Card>
    </OrgsShell>
  );
}

/* ---------- Work queue (MKT-UI-005) ---------- */

export function WorkQueue() {
  const rows = [
    {
      when: "Tue, Oct 21 · 10:00 AM",
      p: "marcus" as PersonKey,
      client: "Example SGP Gold Corp",
      opening: "#3 Senior product designer",
      stage: "Design panel interview",
      status: <Tag color="success">Accepted</Tag>,
    },
    {
      when: "Tue, Oct 21 · 3:30 PM",
      p: "lukas" as PersonKey,
      client: "Example DEU GmbH",
      opening: "#14 Backend engineer",
      stage: "Technical interview",
      status: <Tag color="success">Accepted</Tag>,
    },
    {
      when: "Wed, Oct 22 · 9:00 AM",
      p: "emily" as PersonKey,
      client: "Example USA1 Silver Inc",
      opening: "#8 Data scientist",
      stage: "Case interview",
      status: <Tag color="warning">Awaiting response</Tag>,
    },
    {
      when: "Mon, Oct 27 · 9:00 AM",
      p: "marcus" as PersonKey,
      client: "Example SGP Gold Corp",
      opening: "#3 Senior product designer",
      stage: "Design panel interview",
      status: <Tag color="warning">Another time requested</Tag>,
    },
    {
      when: "Not scheduled",
      p: "arun" as PersonKey,
      client: "Example SGP Gold Corp",
      opening: "#3 Senior product designer",
      stage: "Design panel interview",
      status: <Tag>To schedule</Tag>,
    },
    {
      when: "Fri, Oct 17 · 4:00 PM",
      p: "anna" as PersonKey,
      client: "Example DEU GmbH",
      opening: "#11 Product manager",
      stage: "Panel interview",
      status: <Tag color="error">Feedback due</Tag>,
    },
  ];
  return (
    <OrgsShell kind="provider" selected="work">
      <PageHeader
        title="Work queue"
        intro="Candidates your clients routed to you. You see only what each stage needs, while it is routed to you."
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Interviews in the next 7 days" value={5} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="To schedule" value={3} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Feedback due"
              value={2}
              styles={{ content: { color: "#dc2626" } }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Reschedule requests" value={1} />
          </Card>
        </Col>
      </Row>
      <Card>
        <Tabs
          activeKey="upcoming"
          items={[
            { key: "upcoming", label: "Upcoming interviews" },
            { key: "all", label: "All work (19)" },
          ]}
        />
        <Flex gap="small" wrap style={{ marginBottom: 16 }}>
          <Input.Search placeholder="Search candidate" style={{ width: 220 }} />
          <Select className="filter-select" placeholder="Client" options={[]} />
          <Select
            className="filter-select"
            placeholder="Opening"
            options={[]}
          />
          <Select className="filter-select" placeholder="Status" options={[]} />
        </Flex>
        <Table
          rowKey={(r) => r.when + r.p}
          pagination={false}
          dataSource={rows}
          columns={[
            {
              title: "When",
              dataIndex: "when",
              render: (v) =>
                v === "Not scheduled" ? <Text type="secondary">{v}</Text> : v,
            },
            {
              title: "Candidate",
              key: "p",
              render: (_, r) => <Person p={r.p} sub={PEOPLE[r.p].country} />,
            },
            { title: "Client", dataIndex: "client" },
            {
              title: "Opening · stage",
              key: "o",
              render: (_, r) => (
                <Flex orientation="vertical">
                  <Text>{r.opening}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.stage}
                  </Text>
                </Flex>
              ),
            },
            { title: "Status", dataIndex: "status" },
          ]}
        />
      </Card>
    </OrgsShell>
  );
}

export function ProviderWorkItem() {
  return (
    <OrgsShell kind="provider" selected="work">
      <PageHeader
        crumbs={["Work queue", "Marcus Reed"]}
        title="Marcus Reed"
        tags={<CapabilityTag c="interviewing" />}
        intro={
          <>
            {CONSUMER.name} · {OPENING.title} #{OPENING.number} · Stage: Design
            panel interview
          </>
        }
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="You see this candidate while Example SGP Gold Corp routes them to you at this stage. Your client sees everything you record here."
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <Flex orientation="vertical" gap="middle">
            <Card
              title="Interviews"
              extra={
                <Button icon={<PlusOutlined />} type="primary">
                  Schedule interview
                </Button>
              }
            >
              <Flex orientation="vertical" gap="small">
                <Card
                  size="small"
                  title={
                    <Flex gap="small" align="center">
                      <Text strong>Interview 1</Text>
                      <Tag color="success">Accepted</Tag>
                    </Flex>
                  }
                  extra={
                    <Flex gap="small">
                      <Button size="small">Change</Button>
                      <Button size="small" type="text" danger>
                        Cancel
                      </Button>
                    </Flex>
                  }
                >
                  <Descriptions
                    size="small"
                    column={{ xs: 1, md: 2 }}
                    items={[
                      {
                        key: "w",
                        label: "When",
                        children: "Tue, Oct 21, 2026, 4:00 AM CEST · 60 min",
                      },
                      {
                        key: "m",
                        label: "Mode",
                        children: (
                          <Flex gap={6}>
                            <VideoCameraOutlined />
                            <Link>meet.interviewpanel.example/r/8x2k</Link>
                          </Flex>
                        ),
                      },
                      {
                        key: "i",
                        label: "Interviewers",
                        children: "Jana Koch (you), Tobias Wolf",
                      },
                      {
                        key: "f",
                        label: "After the interview",
                        children: (
                          <Text type="secondary">
                            Record completed or no-show, then each interviewer
                            submits feedback
                          </Text>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card
                  size="small"
                  title={
                    <Flex gap="small" align="center">
                      <Text strong>Interview 2</Text>
                      <Tag color="warning">Another time requested</Tag>
                    </Flex>
                  }
                  extra={
                    <Button size="small" type="primary">
                      Change time
                    </Button>
                  }
                >
                  <Alert
                    type="warning"
                    style={{ marginBottom: 8 }}
                    title={`"Could we do the afternoon? I'm flying back from Jakarta that morning."`}
                  />
                  <Descriptions
                    size="small"
                    column={{ xs: 1, md: 2 }}
                    items={[
                      {
                        key: "w",
                        label: "When",
                        children: "Mon, Oct 27, 2026, 3:00 AM CET · 45 min",
                      },
                      {
                        key: "m",
                        label: "Mode",
                        children:
                          "In person · Marina Bay Financial Centre, Tower 3, 12F",
                      },
                    ]}
                  />
                </Card>
              </Flex>
            </Card>
            <Card title="What you don't see">
              <Text type="secondary">
                Other stages and their results, offers, whether an agency
                referred this person, and other providers' work stay with your
                client.
              </Text>
            </Card>
          </Flex>
        </Col>
        <Col xs={24} lg={9}>
          <Flex orientation="vertical" gap="middle">
            <SnapshotCard p="marcus" />
            <CoverNote />
          </Flex>
        </Col>
      </Row>
    </OrgsShell>
  );
}

export function ProviderBackgroundCheck() {
  return (
    <OrgsShell kind="provider" selected="work">
      <PageHeader
        crumbs={["Work queue", "Siti Nurhaliza Yusof"]}
        title="Siti Nurhaliza Yusof"
        tags={<CapabilityTag c="background_check" />}
        intro={
          <>
            {CONSUMER.name} · {OPENING.title} #{OPENING.number} · Stage:
            Background check
          </>
        }
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <Card
            title="Checks"
            extra={<Tag color="success">Consent given Oct 16, 2026</Tag>}
          >
            <Paragraph type="secondary">
              Record an outcome for each check your client selected. Link to
              your own report; Vetchium stores no report files.
            </Paragraph>
            <Flex orientation="vertical" gap="small">
              <Card
                size="small"
                title="Identity"
                extra={<Tag color="success">Clear · recorded Oct 17</Tag>}
              />
              <Card
                size="small"
                title="Employment"
                extra={<Tag color="warning">Discrepancy · recorded Oct 18</Tag>}
              >
                <Text>
                  Previous employer confirms end date Feb 2022, not Jun 2022 as
                  stated.
                </Text>
              </Card>
              <Card size="small" title="Education" extra={<Tag>Pending</Tag>}>
                <Form layout="vertical">
                  <Form.Item label="Outcome" required>
                    <Radio.Group
                      value="clear"
                      optionType="button"
                      options={[
                        { value: "clear", label: "Clear" },
                        { value: "discrepancy", label: "Discrepancy" },
                        { value: "unable", label: "Unable to verify" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    label="Note"
                    extra="Optional. Up to 2,000 characters."
                  >
                    <Input.TextArea
                      rows={2}
                      value="NUS registrar confirmed B.Des Interaction Design, 2018."
                    />
                  </Form.Item>
                  <Form.Item
                    label="Report link"
                    extra="Optional https:// link to the report on your system."
                  >
                    <Input
                      prefix={<LinkOutlined />}
                      value="https://reports.veritycheck.example/r/7Q2M"
                    />
                  </Form.Item>
                  <Button type="primary">Record outcome</Button>
                </Form>
              </Card>
              <Card
                size="small"
                title="Criminal record"
                extra={<Tag>Pending</Tag>}
              />
            </Flex>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <SnapshotCard p="siti" />
        </Col>
      </Row>
    </OrgsShell>
  );
}

/* ---------- Agency: Jobs (MKT-UI-006) ---------- */

export function JobsPage() {
  return (
    <OrgsShell kind="agency" selected="jobs">
      <PageHeader
        title="Jobs"
        intro="Openings your clients assigned to you. Suggest them to your contacts; people who name you when they apply are credited to you."
      />
      <Card>
        <Flex
          justify="space-between"
          gap="small"
          wrap
          style={{ marginBottom: 16 }}
        >
          <Segmented
            value="Published (7)"
            options={[
              "Published (7)",
              "Paused (1)",
              "Closed (3)",
              "Expired (0)",
            ]}
          />
        </Flex>
        <Flex gap="small" wrap style={{ marginBottom: 16 }}>
          <Input.Search placeholder="Search title" style={{ width: 240 }} />
          <Select className="filter-select" placeholder="Client" options={[]} />
          <Select
            className="filter-select"
            placeholder="Employing country"
            options={[]}
          />
        </Flex>
        <Table
          rowKey="t"
          pagination={false}
          dataSource={[
            {
              t: "Senior product designer",
              n: 3,
              c: "Example SGP Gold Corp",
              co: "Singapore",
              at: "Sep 3, 2026",
              cr: 3,
            },
            {
              t: "Staff engineer, payments",
              n: 12,
              c: "Example SGP Gold Corp",
              co: "Singapore",
              at: "Sep 3, 2026",
              cr: 2,
            },
            {
              t: "Design manager",
              n: 14,
              c: "Example SGP Gold Corp",
              co: "Singapore",
              at: "Oct 1, 2026",
              cr: 0,
            },
            {
              t: "Backend engineer",
              n: 14,
              c: "Example DEU GmbH",
              co: "Germany",
              at: "Aug 20, 2026",
              cr: 4,
            },
            {
              t: "Data scientist",
              n: 8,
              c: "Example USA1 Silver Inc",
              co: "United States",
              at: "Aug 2, 2026",
              cr: 1,
            },
          ]}
          columns={[
            {
              title: "Opening",
              key: "t",
              render: (_, r) => (
                <Flex orientation="vertical">
                  <Link>{r.t}</Link>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    #{r.n}
                  </Text>
                </Flex>
              ),
            },
            { title: "Client", dataIndex: "c" },
            { title: "Employing country", dataIndex: "co" },
            {
              title: "State",
              key: "s",
              render: () => <Tag color="success">Published</Tag>,
            },
            { title: "Assigned", dataIndex: "at" },
            { title: "Credited to you", dataIndex: "cr", align: "end" },
          ]}
        />
      </Card>
    </OrgsShell>
  );
}

function JobFrame({ modal }: { modal?: ReactNode }) {
  return (
    <OrgsShell kind="agency" selected="jobs">
      <PageHeader
        crumbs={["Jobs", OPENING.title]}
        title={OPENING.title}
        suffix="#3"
        tags={<Tag color="success">Published</Tag>}
        intro={<>{CONSUMER.name} · Assigned to you Sep 3, 2026</>}
        extra={
          <Button type="primary" icon={<SendOutlined />}>
            Suggest to a contact
          </Button>
        }
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <Tabs
            activeKey="opening"
            items={[
              { key: "opening", label: "Opening" },
              { key: "credited", label: "Credited applications (3)" },
              { key: "suggested", label: "Suggested to (5)" },
            ]}
          />
          <Card>
            <Text type="secondary" style={{ fontSize: 12 }}>
              As candidates see it
            </Text>
            <Divider style={{ margin: "8px 0 16px" }} />
            <OpeningContent />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Flex orientation="vertical" gap="middle">
            <Card title="Your work on this Opening">
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic title="Suggested to" value={5} suffix="contacts" />
                </Col>
                <Col span={12}>
                  <Statistic title="Credited" value={3} suffix="applications" />
                </Col>
              </Row>
            </Card>
            <Card title="Credited applications">
              <Flex orientation="vertical" gap="middle">
                {(
                  [
                    ["marcus", "interviewing", "suggested"],
                    ["priya", "hired", "declared"],
                    ["vaidehi", "applied", "suggested"],
                  ] as const
                ).map(([p, s, r]) => (
                  <Flex key={p} justify="space-between" align="center">
                    <Person p={p} sub={PEOPLE[p].country} />
                    <Flex gap={4}>
                      <RouteTag r={r} />
                      <HubStatusTag s={s} />
                    </Flex>
                  </Flex>
                ))}
              </Flex>
              <Paragraph
                type="secondary"
                style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}
              >
                You see each credited person's general status only. Applications
                not credited to you stay private.
              </Paragraph>
            </Card>
          </Flex>
        </Col>
      </Row>
      {modal}
    </OrgsShell>
  );
}

export function JobDetail() {
  return <JobFrame />;
}

export function SuggestModal() {
  return (
    <JobFrame
      modal={
        <Modal
          open
          title="Suggest to a contact"
          okText="Send suggestion"
          width={560}
        >
          <Form layout="vertical">
            <Form.Item label="Contact" required>
              <Select
                open
                value="arun"
                style={{ width: "100%" }}
                options={[
                  {
                    value: "arun",
                    label: (
                      <Flex gap="small" align="center">
                        <PersonAvatar name="Arun Kumar Pillai" size={20} />
                        Arun Kumar Pillai{" "}
                        <Text type="secondary">@arunpil-8hq2</Text>
                      </Flex>
                    ),
                  },
                  {
                    value: "jiahao",
                    label: (
                      <Flex gap="small" align="center">
                        <PersonAvatar name="Jia Hao Koh" size={20} />
                        Jia Hao Koh{" "}
                        <Text type="secondary">
                          @jiahaokoh-q8w2 · already suggested Oct 3
                        </Text>
                      </Flex>
                    ),
                  },
                  {
                    value: "sofia",
                    disabled: true,
                    label: (
                      <Flex gap="small" align="center">
                        <PersonAvatar name="Sofia Martinez" size={20} />
                        Sofia Martinez{" "}
                        <Text type="secondary">
                          · doesn't accept messages from agencies
                        </Text>
                      </Flex>
                    ),
                  },
                ]}
              />
            </Form.Item>
            <div style={{ height: 120 }} />
            <Form.Item label="What they receive">
              <Card size="small">
                <Flex gap="small" align="center">
                  <OrgLogo name="Example SGP Gold Corp" color="#ca8a04" />
                  <Flex orientation="vertical">
                    <Text strong>{OPENING.title}</Text>
                    <Text type="secondary">
                      {CONSUMER.name} · Singapore · Hybrid · Full time
                    </Text>
                  </Flex>
                </Flex>
              </Card>
            </Form.Item>
          </Form>
          <Text type="secondary">
            Arun decides whether to apply. If they do, they choose which agency,
            if any, to credit.
          </Text>
        </Modal>
      }
    />
  );
}

/* ---------- Agency: Contacts, notes, conversation, profile (MKT-CON, MKT-NOTE, MKT-UI-007/008) ---------- */

export function ContactsPage() {
  const rows: {
    p: PersonKey;
    last: string;
    unread: number;
    notes: number;
    cr: number;
    conv: boolean;
    flag?: ReactNode;
  }[] = [
    {
      p: "arun",
      last: "Today, 11:02 AM",
      unread: 1,
      notes: 2,
      cr: 0,
      conv: true,
    },
    { p: "marcus", last: "Yesterday", unread: 2, notes: 1, cr: 1, conv: true },
    {
      p: "lukas",
      last: "Oct 17, 2026",
      unread: 0,
      notes: 3,
      cr: 0,
      conv: false,
    },
    {
      p: "vaidehi",
      last: "Oct 15, 2026",
      unread: 0,
      notes: 0,
      cr: 1,
      conv: true,
    },
    {
      p: "david",
      last: "Oct 12, 2026",
      unread: 0,
      notes: 1,
      cr: 0,
      conv: false,
    },
    { p: "priya", last: "Oct 9, 2026", unread: 0, notes: 4, cr: 1, conv: true },
    {
      p: "sofia",
      last: "Oct 2, 2026",
      unread: 0,
      notes: 1,
      cr: 0,
      conv: true,
      flag: <Tag>Messages off</Tag>,
    },
    {
      p: "kevin",
      last: "Sep 12, 2026",
      unread: 0,
      notes: 0,
      cr: 0,
      conv: true,
      flag: <Tag>Account deleted</Tag>,
    },
  ];
  return (
    <OrgsShell kind="agency" selected="contacts">
      <PageHeader
        title="Contacts"
        extra={
          <Button type="primary" icon={<PlusOutlined />}>
            New contact
          </Button>
        }
        intro="Everyone your agency has written a note about or messaged. It is also your shared inbox. A contact becomes an applicant only by applying."
      />
      <Card>
        <Flex
          justify="space-between"
          wrap
          gap="small"
          style={{ marginBottom: 16 }}
        >
          <Segmented
            value="All (8)"
            options={[
              "All (8)",
              "Unread (3)",
              "In conversation (6)",
              "Not contacted (2)",
            ]}
          />
          <Input.Search placeholder="Search by name" style={{ width: 240 }} />
        </Flex>
        <Table
          rowKey="p"
          pagination={false}
          dataSource={rows}
          columns={[
            {
              title: "Name",
              key: "p",
              render: (_, r) => (
                <Person p={r.p} sub={`@${PEOPLE[r.p].handle}`} />
              ),
            },
            {
              title: "Status",
              key: "s",
              render: (_, r) => (
                <Flex gap={4} wrap>
                  {r.conv ? (
                    <Tag color="blue">In conversation</Tag>
                  ) : (
                    <Tag>Not contacted</Tag>
                  )}
                  {r.flag}
                </Flex>
              ),
            },
            { title: "Last activity", dataIndex: "last" },
            {
              title: "Unread",
              key: "u",
              align: "end",
              render: (_, r) => (r.unread ? <Badge count={r.unread} /> : null),
            },
            { title: "Notes", dataIndex: "notes", align: "end" },
            { title: "Credited", dataIndex: "cr", align: "end" },
          ]}
        />
        <Text type="secondary" style={{ display: "block", marginTop: 16 }}>
          Today: 37 of 200 new contacts, 12 of 50 new conversations.
        </Text>
      </Card>
    </OrgsShell>
  );
}

function ContactTabs({
  active,
  conversation = true,
  notes,
}: {
  active: string;
  conversation?: boolean;
  notes: number;
}) {
  // Suggestions are messages, so a Contact never messaged has none.
  const suggested = conversation ? 2 : 0;
  return (
    <Tabs
      activeKey={active}
      items={[
        ...(conversation ? [{ key: "conv", label: "Conversation" }] : []),
        { key: "notes", label: `Notes (${notes})` },
        { key: "profile", label: "Profile" },
        { key: "sugg", label: `Suggested Openings (${suggested})` },
        { key: "cred", label: "Credited applications (0)" },
      ]}
    />
  );
}

const ARUN_NOTES = [
  {
    who: "Rachel Kim",
    when: "Oct 16, 2026, 6:40 PM",
    mine: true,
    edited: false,
    text: "Says he led the merchant onboarding redesign end to end. His former manager, on a reference call, said he owned research and flows but not the visual system. Probe this before putting him forward for lead roles.",
  },
  {
    who: "Daniel Ortiz",
    when: "Sep 30, 2026, 10:05 AM",
    mine: false,
    edited: true,
    text: "Prefers hybrid, two months' notice. Not open to relocating before mid-2027.",
  },
];

function NotesList({
  notes,
}: {
  notes: {
    who: string;
    when: string;
    mine: boolean;
    edited: boolean;
    text: string;
  }[];
}) {
  return (
    <Flex orientation="vertical" gap="small">
      {notes.map((n) => (
        <Card
          key={n.when}
          size="small"
          title={
            <Flex gap="small" align="center">
              <PersonAvatar name={n.who} size={24} />
              <Text>{n.who}</Text>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {n.when}
                {n.edited ? " · edited" : ""}
              </Text>
            </Flex>
          }
          extra={
            <Flex gap={4}>
              {n.mine ? (
                <Button size="small" type="text" icon={<EditOutlined />}>
                  Edit
                </Button>
              ) : null}
              <Button size="small" type="text" danger icon={<DeleteOutlined />}>
                Delete
              </Button>
            </Flex>
          }
        >
          <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
            {n.text}
          </Paragraph>
        </Card>
      ))}
    </Flex>
  );
}

function NoteComposer({ name }: { name: string }) {
  return (
    <Flex orientation="vertical" gap="small">
      <Input.TextArea
        rows={3}
        placeholder="Add a note for your agency"
        showCount
        maxLength={5000}
        style={{ marginBottom: 20 }}
      />
      <Flex justify="space-between" align="center" gap="small" wrap>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Only your agency sees notes; {name} never does. They are deleted 2
          years after your last note or message, or when {name} deletes their
          account.
        </Text>
        <Button type="primary">Add note</Button>
      </Flex>
    </Flex>
  );
}

export function ContactNotes() {
  return (
    <OrgsShell kind="agency" selected="contacts">
      <PageHeader
        crumbs={["Contacts", "Arun Kumar Pillai"]}
        title="Arun Kumar Pillai"
        suffix="@arunpil-8hq2"
        intro="Product Designer at Grab · Singapore · Contact since Sep 28, 2026"
      />
      <ContactTabs active="notes" notes={2} />
      <Card>
        <NoteComposer name="Arun" />
        <Divider />
        <NotesList notes={ARUN_NOTES} />
      </Card>
    </OrgsShell>
  );
}

export function ContactNotContacted() {
  return (
    <OrgsShell kind="agency" selected="contacts">
      <PageHeader
        crumbs={["Contacts", PEOPLE.lukas.name]}
        title={PEOPLE.lukas.name}
        suffix={`@${PEOPLE.lukas.handle}`}
        tags={<Tag>Not contacted</Tag>}
        extra={
          <Button type="primary" icon={<SendOutlined />}>
            Send first message
          </Button>
        }
        intro={`${PEOPLE.lukas.headline} · ${PEOPLE.lukas.country} · Contact since Oct 3, 2026`}
      />
      <ContactTabs active="notes" conversation={false} notes={3} />
      <Card>
        <NoteComposer name="Lukas" />
        <Divider />
        <NotesList
          notes={[
            {
              who: "Rachel Kim",
              when: "Oct 17, 2026, 9:12 AM",
              mine: true,
              edited: false,
              text: "Strong fit for the payments staff engineer role at Example SGP Gold Corp once it reopens. Ask about relocation to Singapore.",
            },
            {
              who: "Priya Nair",
              when: "Oct 8, 2026, 4:30 PM",
              mine: false,
              edited: false,
              text: "Lists distributed systems as a core skill. When we placed him for a contract in 2024, the client's tech lead found his consensus-protocol depth thin. Validate with a technical screen before submitting for platform roles.",
            },
            {
              who: "Rachel Kim",
              when: "Oct 3, 2026, 11:00 AM",
              mine: true,
              edited: false,
              text: "Met at a Berlin meetup; gave us his handle. Not looking actively.",
            },
          ]}
        />
      </Card>
    </OrgsShell>
  );
}

export function NewContactProfile() {
  return (
    <OrgsShell kind="agency" selected="contacts">
      <PageHeader
        crumbs={["Contacts", "New contact"]}
        title={PEOPLE.emily.name}
        suffix={`@${PEOPLE.emily.handle}`}
        intro={`${PEOPLE.emily.headline} · ${PEOPLE.emily.country}`}
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <SnapshotCard
            p="emily"
            title="Profile"
            live
            extra={
              <Text type="secondary">Live, as other Hub users see it</Text>
            }
          />
        </Col>
        <Col xs={24} lg={9}>
          <Flex orientation="vertical" gap="middle">
            <Card title="Notes">
              <Paragraph type="secondary">
                No notes yet. Your first note or message adds Emily to your
                contacts. Viewing this profile records nothing.
              </Paragraph>
              <NoteComposer name="Emily" />
            </Card>
            <Card title="Message">
              <Paragraph type="secondary">
                Start a conversation in Vetchium. Emily never shares an email
                address with you.
              </Paragraph>
              <Button icon={<SendOutlined />}>Send first message</Button>
            </Card>
          </Flex>
        </Col>
      </Row>
    </OrgsShell>
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

export function SuggestionCard({ mine }: { mine?: boolean }) {
  return (
    <Card
      size="small"
      style={{
        width: 360,
        maxWidth: "100%",
        alignSelf: mine ? "end" : "start",
      }}
    >
      <Flex orientation="vertical" gap="small">
        <Text type="secondary" style={{ fontSize: 12 }}>
          <AimOutlined /> Opening suggestion
        </Text>
        <Flex gap="small" align="center">
          <OrgLogo name="Example SGP Gold Corp" color="#ca8a04" />
          <Flex orientation="vertical">
            <Text strong>{OPENING.title}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {CONSUMER.name} · Singapore · Hybrid
            </Text>
          </Flex>
        </Flex>
        <Button type={mine ? "default" : "primary"} size="small" block>
          {mine ? "View Opening" : "View and apply"}
        </Button>
      </Flex>
    </Card>
  );
}

export function ContactConversation({
  messagesOff = false,
}: {
  messagesOff?: boolean;
}) {
  const p: PersonKey = messagesOff ? "sofia" : "arun";
  return (
    <OrgsShell kind="agency" selected="contacts">
      <PageHeader
        crumbs={["Contacts", PEOPLE[p].name]}
        title={PEOPLE[p].name}
        suffix={`@${PEOPLE[p].handle}`}
        tags={messagesOff ? <Tag>Messages off</Tag> : null}
        intro={
          <>
            {PEOPLE[p].headline} · {PEOPLE[p].country} · Contact since Sep 28,
            2026
          </>
        }
      />
      <ContactTabs active="conv" notes={messagesOff ? 1 : 2} />
      <Card>
        {messagesOff ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title="This person does not accept messages from agencies"
            description="The conversation is read-only until they turn agency messages back on. You can still view their profile."
          />
        ) : null}
        <Flex orientation="vertical" gap="middle" style={{ marginBottom: 16 }}>
          <Bubble
            mine
            who="Rachel Kim · Northstar Talent"
            when="Sep 28, 10:14 AM"
          >{`Hi ${PEOPLE[p].name.split(" ")[0]} — I'm Rachel at Northstar Talent. We work with a few design-led companies in Singapore. Your recent work caught my eye. Open to hearing about senior roles?`}</Bubble>
          <Bubble mine={false} who={PEOPLE[p].name} when="Sep 29, 8:40 PM">
            Thanks Rachel. I'm happy where I am but would consider the right
            senior role, especially hybrid.
          </Bubble>
          <Bubble
            mine
            who="Daniel Ortiz · Northstar Talent"
            when="Oct 1, 9:02 AM"
          >
            Here's one that fits — hybrid, Marina Bay, design lead for the
            candidate experience.
          </Bubble>
          <SuggestionCard mine />
          <Bubble mine={false} who={PEOPLE[p].name} when="Today, 11:02 AM">
            Looks interesting. Is the team open to someone who has mostly worked
            on payments?
          </Bubble>
        </Flex>
        <Divider />
        <Flex orientation="vertical" gap="small">
          <Input.TextArea
            rows={3}
            disabled={messagesOff}
            placeholder={
              messagesOff
                ? "You can't write to this person right now."
                : "Write a message"
            }
            showCount
            maxLength={5000}
            style={{ marginBottom: 20 }}
          />
          <Flex justify="space-between">
            <Button icon={<AimOutlined />} disabled={messagesOff}>
              Suggest an Opening
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={messagesOff}
            >
              Send
            </Button>
          </Flex>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Everyone in your agency with Provider staff access sees this
            conversation. {PEOPLE[p].name.split(" ")[0]} never sees your
            colleagues' email addresses, and you never see theirs.
          </Text>
        </Flex>
      </Card>
    </OrgsShell>
  );
}

export function ContactProfile() {
  return (
    <OrgsShell kind="agency" selected="contacts">
      <PageHeader
        crumbs={["Contacts", "Arun Kumar Pillai"]}
        title="Arun Kumar Pillai"
        suffix="@arunpil-8hq2"
        intro="Product Designer at Grab · Singapore · Contact since Sep 28, 2026"
      />
      <ContactTabs active="profile" notes={2} />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <SnapshotCard
            p="arun"
            title="Profile"
            live
            extra={
              <Text type="secondary">Live, as other Hub users see it</Text>
            }
          />
        </Col>
        <Col xs={24} lg={9}>
          <Card title="Verified professional emails">
            <Paragraph type="secondary">
              Domains where Arun proved they controlled an address. Verification
              confirms the mailbox, not a job title or dates.
            </Paragraph>
            <Table
              size="small"
              pagination={false}
              rowKey="d"
              dataSource={[
                { d: "grab.com", f: "Mar 2023", l: "Oct 2026" },
                { d: "foodpanda.sg", f: "Jan 2020", l: "Feb 2021" },
              ]}
              columns={[
                { title: "Domain", dataIndex: "d" },
                { title: "First verified", dataIndex: "f" },
                { title: "Last verified", dataIndex: "l" },
              ]}
            />
          </Card>
          <Card
            title="Your notes"
            extra={<Button size="small">Add note</Button>}
            style={{ marginTop: 16 }}
          >
            <Paragraph style={{ marginBottom: 4 }}>
              {ARUN_NOTES[0].text}
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {ARUN_NOTES[0].who} · {ARUN_NOTES[0].when} · 1 more note
            </Text>
          </Card>
        </Col>
      </Row>
    </OrgsShell>
  );
}

export function CreditedApplications() {
  const rows: {
    p: PersonKey;
    client: string;
    opening: string;
    r: "suggested" | "declared";
    s: string;
    at: string;
  }[] = [
    {
      p: "vaidehi",
      client: "Example SGP Gold Corp",
      opening: "#3 Senior product designer",
      r: "suggested",
      s: "applied",
      at: "Oct 16, 2026",
    },
    {
      p: "marcus",
      client: "Example SGP Gold Corp",
      opening: "#3 Senior product designer",
      r: "suggested",
      s: "interviewing",
      at: "Oct 2, 2026",
    },
    {
      p: "priya",
      client: "Example SGP Gold Corp",
      opening: "#3 Senior product designer",
      r: "declared",
      s: "hired",
      at: "Sep 20, 2026",
    },
    {
      p: "lukas",
      client: "Example DEU GmbH",
      opening: "#14 Backend engineer",
      r: "suggested",
      s: "in_review",
      at: "Sep 18, 2026",
    },
    {
      p: "emily",
      client: "Example USA1 Silver Inc",
      opening: "#8 Data scientist",
      r: "declared",
      s: "not_progressing",
      at: "Aug 30, 2026",
    },
  ];
  return (
    <OrgsShell kind="agency" selected="credited">
      <PageHeader
        title="Credited applications"
        intro="Applications where the person named your agency. You see each one's general status, the same as the applicant sees."
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="Credited" value={24} />
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="In progress" value={9} />
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="Hired" value={3} />
          </Card>
        </Col>
      </Row>
      <Card>
        <Flex gap="small" wrap style={{ marginBottom: 16 }}>
          <Select className="filter-select" placeholder="Client" options={[]} />
          <Select
            className="filter-select"
            placeholder="Opening"
            options={[]}
          />
          <Select className="filter-select" placeholder="Route" options={[]} />
          <Select className="filter-select" placeholder="Status" options={[]} />
        </Flex>
        <Table
          rowKey={(r) => r.p + r.opening}
          pagination={false}
          dataSource={rows}
          columns={[
            {
              title: "Applicant",
              key: "p",
              render: (_, r) => <Person p={r.p} sub={PEOPLE[r.p].country} />,
            },
            { title: "Client", dataIndex: "client" },
            { title: "Opening", dataIndex: "opening" },
            {
              title: "Route",
              key: "r",
              render: (_, r) => <RouteTag r={r.r} />,
            },
            {
              title: "Status",
              key: "s",
              render: (_, r) => <HubStatusTag s={r.s} />,
            },
            { title: "Applied", dataIndex: "at" },
          ]}
        />
      </Card>
    </OrgsShell>
  );
}

export {
  ClockCircleOutlined,
  MinusCircleOutlined,
  DeleteOutlined,
  Checkbox,
  Badge,
  AGENCIES,
  Agency,
  Title,
};
