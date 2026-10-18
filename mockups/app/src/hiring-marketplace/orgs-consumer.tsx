import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FilePdfOutlined,
  FilterOutlined,
  HolderOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
  VideoCameraOutlined,
  EnvironmentOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import {
  Affix,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Row,
  Segmented,
  Select,
  Statistic,
  Steps,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import type { ReactNode } from "react";
import {
  AGENCIES,
  Agency,
  AppStateTag,
  CapabilityTag,
  CONSUMER,
  CoverNote,
  EngagementStateTag,
  OPENING,
  OpeningContent,
  OrgLogo,
  PEOPLE,
  Person,
  type PersonKey,
  RouteTag,
  SnapshotCard,
  STAGE_KIND,
  Waiting,
  type AgencyKey,
} from "./common";
import { OrgsShell, PageHeader } from "../shell";

const { Text, Paragraph, Link, Title } = Typography;

export const STAGES = [
  { id: 1, name: "Portfolio review", kind: "review", count: 1 },
  { id: 2, name: "Design exercise", kind: "assessment", count: 1 },
  { id: 3, name: "Design panel interview", kind: "interview", count: 1 },
  { id: 4, name: "Hiring manager interview", kind: "interview", count: 1 },
  { id: 5, name: "Background check", kind: "background_check", count: 1 },
];

/* ---------- Opening detail frame with the new tabs (HP-ORG-001) ---------- */

export function OpeningFrame({
  tab,
  children,
  kind,
}: {
  tab: string;
  children: ReactNode;
  kind?: "consumer";
}) {
  return (
    <OrgsShell kind={kind} selected="openings">
      <PageHeader
        crumbs={["Openings", `${OPENING.title} #${OPENING.number}`]}
        title={OPENING.title}
        suffix={`#${OPENING.number}`}
        tags={<Tag color="success">Published</Tag>}
        extra={
          <>
            <Button icon={<EditOutlined />}>Edit</Button>
            <Button icon={<CopyOutlined />}>Duplicate</Button>
            <Button>Pause</Button>
            <Button danger>Close</Button>
          </>
        }
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="New applicants" value={6} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Candidates" value={7} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Hired" value={1} suffix="/ 2 positions" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Expires"
              value="Apr 16, 2027"
              styles={{ content: { fontSize: 20 } }}
            />
          </Card>
        </Col>
      </Row>
      <Tabs
        activeKey={tab}
        items={[
          { key: "overview", label: "Overview" },
          {
            key: "applicants",
            label: (
              <Flex gap={6} align="center">
                Applicants <Badge count={6} color="blue" />
              </Flex>
            ),
          },
          {
            key: "candidates",
            label: (
              <Flex gap={6} align="center">
                Candidates <Badge count={7} color="gray" />
              </Flex>
            ),
          },
          { key: "pipeline", label: "Pipeline" },
          { key: "providers", label: "Providers" },
        ].map((t) => ({ ...t, children: t.key === tab ? children : null }))}
      />
    </OrgsShell>
  );
}

const APPLICANTS: {
  p: PersonKey;
  n: number;
  at: string;
  agency?: AgencyKey;
  route?: "suggested" | "declared";
}[] = [
  {
    p: "vaidehi",
    n: 19,
    at: "Oct 16, 2026",
    agency: "northstar",
    route: "suggested",
  },
  { p: "jiahao", n: 18, at: "Oct 15, 2026" },
  {
    p: "sofia",
    n: 17,
    at: "Oct 14, 2026",
    agency: "lioncity",
    route: "declared",
  },
  { p: "anna", n: 16, at: "Oct 12, 2026" },
  {
    p: "meiling",
    n: 15,
    at: "Oct 11, 2026",
    agency: "northstar",
    route: "suggested",
  },
  { p: "kevin", n: 14, at: "Oct 9, 2026" },
];

function ReferredBy({
  agency,
  route,
}: {
  agency?: AgencyKey;
  route?: "suggested" | "declared";
}) {
  if (!agency) return <Text type="secondary">Direct</Text>;
  return (
    <Flex gap="small" align="center" wrap>
      <Agency a={agency} sub={AGENCIES[agency].domain} />
      {route ? <RouteTag r={route} /> : null}
    </Flex>
  );
}

export function ApplicantsTab() {
  return (
    <Card>
      <Paragraph type="secondary">
        People who applied and are waiting for a first decision. Shortlist
        someone to move them into your pipeline as a candidate.
      </Paragraph>
      <Flex gap="small" wrap style={{ marginBottom: 16 }}>
        <Input.Search placeholder="Search by name" style={{ width: 280 }} />
        <Select
          className="filter-select"
          placeholder="Referred by"
          options={[{ value: "any", label: "Any" }]}
        />
        <Button icon={<FilterOutlined />}>More filters</Button>
      </Flex>
      <Table
        rowKey="n"
        pagination={false}
        dataSource={APPLICANTS}
        columns={[
          {
            title: "Applicant",
            key: "p",
            render: (_, r) => <Person p={r.p} />,
          },
          { title: "Application", key: "n", render: (_, r) => `#${r.n}` },
          { title: "Applied", dataIndex: "at" },
          {
            title: "Referred by",
            key: "ref",
            render: (_, r) => <ReferredBy agency={r.agency} route={r.route} />,
          },
          {
            title: "Actions",
            key: "a",
            align: "end",
            render: () => (
              <Flex gap="small" justify="end">
                <Button size="small" type="primary">
                  Shortlist
                </Button>
                <Button size="small">Not progressing</Button>
              </Flex>
            ),
          },
        ]}
      />
      <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
        <Button disabled>Previous</Button>
        <Button disabled>Next</Button>
      </Flex>
    </Card>
  );
}

const CANDIDATES: {
  p: PersonKey;
  n: number;
  stage: string;
  kind: string;
  status: ReactNode;
  route: ReactNode;
  next?: string;
  state?: string;
  updated: string;
}[] = [
  {
    p: "maithili",
    n: 13,
    stage: "Portfolio review",
    kind: "review",
    status: <Tag>Pending</Tag>,
    route: <Text>In-house</Text>,
    updated: "Oct 17",
  },
  {
    p: "david",
    n: 11,
    stage: "Design exercise",
    kind: "assessment",
    status: <Tag>Pending</Tag>,
    route: <Agency a="skillproof" link={false} />,
    updated: "Oct 16",
  },
  {
    p: "marcus",
    n: 12,
    stage: "Design panel interview",
    kind: "interview",
    status: <Waiting>Interview response</Waiting>,
    route: <Agency a="panel" link={false} />,
    next: "Oct 21, 10:00 AM",
    updated: "Oct 17",
  },
  {
    p: "arun",
    n: 9,
    stage: "Hiring manager interview",
    kind: "interview",
    status: <Tag color="processing">Feedback 1 of 2</Tag>,
    route: <Text>In-house</Text>,
    updated: "Oct 18",
  },
  {
    p: "siti",
    n: 8,
    stage: "Background check",
    kind: "background_check",
    status: <Tag color="processing">2 of 4 checks recorded</Tag>,
    route: <Agency a="verity" link={false} />,
    updated: "Oct 18",
  },
  {
    p: "rohan",
    n: 6,
    stage: "Offered",
    kind: "",
    status: <Waiting>Offer response · due Oct 30</Waiting>,
    route: <Text type="secondary">—</Text>,
    state: "offered",
    updated: "Oct 16",
  },
  {
    p: "priya",
    n: 4,
    stage: "Offer accepted",
    kind: "",
    status: <Tag color="warning">Record joining</Tag>,
    route: <Text type="secondary">—</Text>,
    state: "offer_accepted",
    updated: "Oct 9",
  },
];

export function CandidatesTab() {
  const stageCards = [
    ...STAGES.map((s) => ({
      key: String(s.id),
      title: `${s.id}. ${s.name}`,
      sub: STAGE_KIND[s.kind],
      count: s.count,
    })),
    { key: "offered", title: "Offered", sub: "Waiting on candidate", count: 1 },
    {
      key: "accepted",
      title: "Offer accepted",
      sub: "Record joining",
      count: 1,
    },
  ];
  return (
    <Flex orientation="vertical" gap="middle">
      <Flex gap="small" wrap>
        <Card size="small" style={{ width: 128, borderColor: "#2563eb" }}>
          <Statistic title="All active" value={7} />
        </Card>
        {stageCards.map((s) => (
          <Card key={s.key} size="small" hoverable style={{ width: 128 }}>
            <Flex orientation="vertical" gap={2}>
              <Text ellipsis style={{ fontSize: 13 }}>
                {s.title}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {s.sub}
              </Text>
              <Text style={{ fontSize: 24 }}>{s.count}</Text>
            </Flex>
          </Card>
        ))}
      </Flex>
      <Card>
        <Flex
          justify="space-between"
          gap="small"
          wrap
          style={{ marginBottom: 16 }}
        >
          <Segmented
            options={[
              "Active (7)",
              "Joined (1)",
              "Not progressing (3)",
              "Withdrawn (1)",
              "Offer declined (0)",
              "Did not join (0)",
            ]}
            value="Active (7)"
          />
        </Flex>
        <Flex gap="small" wrap style={{ marginBottom: 16 }}>
          <Input.Search placeholder="Search by name" style={{ width: 240 }} />
          <Select
            className="filter-select"
            placeholder="Performed by"
            options={[]}
          />
          <Select
            className="filter-select"
            placeholder="Waiting on candidate"
            options={[]}
          />
          <Button icon={<FilterOutlined />}>
            More filters <Badge count={0} showZero={false} />
          </Button>
        </Flex>
        <Table
          rowKey="n"
          pagination={false}
          dataSource={CANDIDATES}
          columns={[
            {
              title: "Candidate",
              key: "p",
              render: (_, r) => (
                <Person p={r.p} sub={`#${r.n} · ${PEOPLE[r.p].country}`} />
              ),
            },
            {
              title: "Stage",
              key: "s",
              render: (_, r) =>
                r.state ? (
                  <AppStateTag s={r.state} />
                ) : (
                  <Flex orientation="vertical">
                    <Text>{r.stage}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {STAGE_KIND[r.kind]}
                    </Text>
                  </Flex>
                ),
            },
            { title: "Performed by", key: "r", render: (_, r) => r.route },
            { title: "Status", key: "st", render: (_, r) => r.status },
            {
              title: "Next interview",
              key: "ni",
              render: (_, r) => r.next ?? <Text type="secondary">—</Text>,
            },
            { title: "Updated", dataIndex: "updated" },
          ]}
        />
      </Card>
    </Flex>
  );
}

export function PipelineTab() {
  return (
    <Card
      title="Stages"
      extra={
        <Flex gap="small" align="center">
          <Tag color="warning">Unsaved changes</Tag>
          <Button>Discard</Button>
          <Button type="primary">Save pipeline</Button>
        </Flex>
      }
    >
      <Paragraph type="secondary">
        Candidates move through these stages in order. The pipeline is internal:
        changes apply at once and never need approval. Candidates only see a
        general status, never stage names.
      </Paragraph>
      <Flex orientation="vertical" gap="small">
        {STAGES.map((s, i) => (
          <Card key={s.id} size="small">
            <Flex gap="middle" align="center" wrap>
              <HolderOutlined style={{ cursor: "grab" }} />
              <Text type="secondary" style={{ width: 16 }}>
                {i + 1}
              </Text>
              <Input
                value={i === 2 ? "Design panel interview (2 rounds)" : s.name}
                style={{ width: 300 }}
                status={undefined}
              />
              <Select
                value={s.kind}
                style={{ width: 180 }}
                disabled={s.count > 0}
                options={Object.entries(STAGE_KIND).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <Text type="secondary" style={{ flex: 1 }}>
                {s.count} candidate{s.count === 1 ? "" : "s"} ·{" "}
                {s.kind === "review"
                  ? "in-house only"
                  : s.kind === "interview" && i === 2
                    ? "1 provider assigned"
                    : s.kind === "interview"
                      ? "in-house"
                      : "1 provider assigned"}
              </Text>
              <Tooltip
                title={
                  s.count > 0
                    ? "Move the candidate at this stage first. You can't remove a stage that holds a candidacy."
                    : undefined
                }
              >
                <Button
                  icon={<DeleteOutlined />}
                  type="text"
                  disabled={s.count > 0}
                  aria-label="Remove stage"
                />
              </Tooltip>
            </Flex>
          </Card>
        ))}
        <Flex justify="space-between" align="center" style={{ marginTop: 8 }}>
          <Button icon={<PlusOutlined />}>Add stage</Button>
          <Text type="secondary">5 of 15 stages</Text>
        </Flex>
      </Flex>
      <Divider />
      <Flex gap="small" align="center">
        <Text type="secondary">After the last stage:</Text>
        <Tag>Offer</Tag>
        <Text type="secondary">→</Text>
        <Tag>Offer accepted</Tag>
        <Text type="secondary">→</Text>
        <Tag>Joined</Tag>
        <Text type="secondary">· You can extend an offer from any stage.</Text>
      </Flex>
    </Card>
  );
}

export function ProvidersTab() {
  return (
    <Flex orientation="vertical" gap="middle">
      <Card
        title="Sourcing agencies"
        extra={
          <Flex gap="small" align="center">
            <Text type="secondary">2 of 20</Text>
            <Button icon={<PlusOutlined />}>Assign agency</Button>
          </Flex>
        }
      >
        <Paragraph type="secondary">
          Assigned agencies see this Opening and can suggest it to people. An
          applicant who names an assigned agency credits it. Removing an agency
          stops new credits; existing credits stay.
        </Paragraph>
        <Table
          pagination={false}
          rowKey="a"
          dataSource={[
            { a: "northstar" as const, since: "Sep 3, 2026", credited: 3 },
            { a: "lioncity" as const, since: "Sep 10, 2026", credited: 1 },
          ]}
          columns={[
            {
              title: "Agency",
              key: "a",
              render: (_, r) => (
                <Agency
                  a={r.a}
                  sub={`${AGENCIES[r.a].domain} · ${AGENCIES[r.a].country}`}
                />
              ),
            },
            { title: "Assigned", dataIndex: "since" },
            {
              title: "Credited applications",
              dataIndex: "credited",
              align: "end",
            },
            {
              title: "",
              key: "x",
              align: "end",
              render: () => <Button size="small">Remove</Button>,
            },
          ]}
        />
      </Card>
      <Card title="Stage providers">
        <Paragraph type="secondary">
          Assign providers you have an active engagement with to a stage. Then
          choose, for each candidate at that stage, whether your team or one of
          these providers does the work.
        </Paragraph>
        <Flex orientation="vertical" gap="small">
          {STAGES.map((s) => {
            const assigned: AgencyKey[] =
              s.kind === "interview" && s.id === 3
                ? ["panel"]
                : s.kind === "assessment"
                  ? ["skillproof"]
                  : s.kind === "background_check"
                    ? ["verity", "meridian"]
                    : [];
            return (
              <Card
                key={s.id}
                size="small"
                title={
                  <Flex gap="small" align="center">
                    <Text>
                      {s.id}. {s.name}
                    </Text>
                    <Tag>{STAGE_KIND[s.kind]}</Tag>
                  </Flex>
                }
                extra={
                  s.kind === "review" ? null : (
                    <Button size="small" icon={<PlusOutlined />}>
                      Assign provider
                    </Button>
                  )
                }
              >
                {s.kind === "review" ? (
                  <Text type="secondary">
                    Review stages are always done by your team.
                  </Text>
                ) : assigned.length === 0 ? (
                  <Text type="secondary">
                    No providers assigned. Your team does this stage.
                  </Text>
                ) : (
                  <Flex gap="large" wrap>
                    {assigned.map((a) => (
                      <Flex key={a} gap="small" align="center">
                        <Agency a={a} />
                        <Button size="small" type="text">
                          Remove
                        </Button>
                      </Flex>
                    ))}
                  </Flex>
                )}
              </Card>
            );
          })}
        </Flex>
      </Card>
    </Flex>
  );
}

export function OpeningOverviewWithCloseModal() {
  return (
    <>
      <OpeningFrame tab="overview">
        <Card title="Live content">
          <OpeningContent />
        </Card>
      </OpeningFrame>
      <Modal
        open
        title="Close this Opening?"
        okText="Close Opening"
        okButtonProps={{ danger: true }}
        cancelText="Keep open"
        width={560}
      >
        <Paragraph>
          Candidates stop seeing <Text strong>{OPENING.title}</Text> and no one
          new can apply. Applications already in progress stay, so you can
          finish hiring.
        </Paragraph>
        <Checkbox checked>
          Also mark the <Text strong>13 open applications</Text> as not
          progressing (6 applicants, 5 candidates in stages, 1 offered, 1 offer
          accepted)
        </Checkbox>
        <Paragraph type="secondary" style={{ marginTop: 8, marginLeft: 24 }}>
          They see "Not progressing" in Vetchium. Upcoming interviews are
          cancelled and providers lose access. Leave this off to keep hiring
          from the people already here.
        </Paragraph>
        <Form layout="vertical">
          <Form.Item
            label="Note"
            extra="Optional. Shown in the Opening's history to your organization only."
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/* ---------- Application detail (HP-ORG-002) ---------- */

type StepState = "finish" | "process" | "wait";

export function ApplicationFrame({
  p,
  n,
  state,
  current,
  stageCard,
  side,
  waiting,
  agency,
  route,
  modal,
}: {
  p: PersonKey;
  n: number;
  state: string;
  current: number;
  stageCard: ReactNode;
  side?: ReactNode;
  waiting?: ReactNode;
  agency?: AgencyKey;
  route?: "suggested" | "declared";
  modal?: ReactNode;
}) {
  const steps = [
    ...STAGES.map((s, i) => ({
      title: s.name,
      content:
        i < current
          ? i === 1
            ? "Pass · 82"
            : "Completed"
          : i === current
            ? "Current"
            : "",
      status: (i < current
        ? "finish"
        : i === current
          ? "process"
          : "wait") as StepState,
    })),
    {
      title: "Offer",
      content: current >= 5 ? "Accepted" : "",
      status: (current >= 5 ? "finish" : "wait") as StepState,
    },
  ];
  return (
    <OrgsShell selected="openings">
      <PageHeader
        crumbs={[
          "Openings",
          `${OPENING.title} #${OPENING.number}`,
          "Candidates",
          PEOPLE[p].name,
        ]}
        title={PEOPLE[p].name}
        suffix={`Application #${n}`}
        tags={<AppStateTag s={state} />}
        intro={
          <>
            {PEOPLE[p].headline} · {PEOPLE[p].country} · Applied Oct 2, 2026
          </>
        }
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Flex orientation="vertical" gap="middle">
            <Card title="Progress">
              <Steps
                size="small"
                current={current}
                items={steps}
                titlePlacement="vertical"
              />
            </Card>
            {stageCard}
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={12}>
                <SnapshotCard p={p} />
              </Col>
              <Col xs={24} xl={12}>
                <CoverNote />
              </Col>
            </Row>
            <Card title="History">
              <Timeline
                items={[
                  {
                    title: "Oct 17, 2026, 3:12 PM",
                    content:
                      "Interview scheduled · Design panel interview · Interview Panel GmbH",
                  },
                  {
                    title: "Oct 14, 2026, 11:40 AM",
                    content:
                      "Moved to Design panel interview · anna.lee@gold.sgp.example.com",
                  },
                  {
                    title: "Oct 13, 2026, 6:05 PM",
                    content: "Result recorded · Design exercise · SkillProof",
                  },
                  {
                    title: "Oct 6, 2026, 9:30 AM",
                    content: "Routed to SkillProof · Design exercise",
                  },
                  {
                    title: "Oct 4, 2026, 10:02 AM",
                    content:
                      "Shortlisted to Portfolio review · recruiter@gold.sgp.example.com",
                  },
                  {
                    title: "Oct 2, 2026, 8:47 PM",
                    content:
                      "Applied · credited to Northstar Talent (suggested)",
                  },
                ]}
              />
            </Card>
          </Flex>
        </Col>
        <Col xs={24} lg={8}>
          <Affix offsetTop={24}>
            <Flex orientation="vertical" gap="middle">
              <Card title="Actions">
                {side ?? (
                  <Flex orientation="vertical" gap="small">
                    <Text>Move to a later stage</Text>
                    <Flex gap="small">
                      <Select
                        style={{ flex: 1 }}
                        placeholder="Choose stage"
                        options={STAGES.slice(current + 1).map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                      />
                      <Button>Move</Button>
                    </Flex>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Stages you pass over are marked skipped.
                    </Text>
                    <Divider style={{ margin: "8px 0" }} />
                    <Button type="primary" block>
                      Extend offer
                    </Button>
                    <Button block danger>
                      Not progressing
                    </Button>
                  </Flex>
                )}
              </Card>
              {waiting ? (
                <Card title="Waiting on candidate">{waiting}</Card>
              ) : null}
              <Card title="Referred by">
                {agency ? (
                  <Flex orientation="vertical" gap="small">
                    <Flex gap="small" align="center">
                      <Agency a={agency} />
                      {route ? <RouteTag r={route} /> : null}
                    </Flex>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {route === "suggested"
                        ? "The agency suggested this Opening to them, and they named it when applying."
                        : "They named this agency when applying."}{" "}
                      Credit is fixed at application time.
                    </Text>
                  </Flex>
                ) : (
                  <Text type="secondary">
                    Applied directly. No agency is credited.
                  </Text>
                )}
              </Card>
            </Flex>
          </Affix>
        </Col>
      </Row>
      {modal}
    </OrgsShell>
  );
}

function RoutePicker({ value, options }: { value: string; options: string[] }) {
  return (
    <Flex gap="small" align="center">
      <Text type="secondary">Performed by</Text>
      <Select
        value={value}
        style={{ width: 210 }}
        options={options.map((o) => ({ value: o, label: o }))}
      />
    </Flex>
  );
}

function InterviewCard({
  title,
  when,
  mode,
  where,
  response,
  interviewers,
  feedback,
  actions,
}: {
  title: string;
  when: string;
  mode: "video" | "in_person";
  where: string;
  response: ReactNode;
  interviewers: string[];
  feedback: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card
      size="small"
      title={
        <Flex gap="small" align="center">
          <Text strong>{title}</Text>
          {response}
        </Flex>
      }
      extra={actions}
    >
      <Descriptions
        size="small"
        column={{ xs: 1, md: 2 }}
        items={[
          { key: "w", label: "When", children: when },
          {
            key: "m",
            label: "Mode",
            children:
              mode === "video" ? (
                <Flex gap={6}>
                  <VideoCameraOutlined />
                  <Link>{where}</Link>
                </Flex>
              ) : (
                <Flex gap={6}>
                  <EnvironmentOutlined />
                  {where}
                </Flex>
              ),
          },
          {
            key: "i",
            label: "Interviewers",
            children: interviewers.join(", "),
          },
          { key: "f", label: "Feedback", children: feedback },
        ]}
      />
    </Card>
  );
}

export function ApplicationMarcus() {
  return (
    <ApplicationFrame
      p="marcus"
      n={12}
      state="in_pipeline"
      current={2}
      agency="northstar"
      route="suggested"
      waiting={
        <Flex orientation="vertical" gap="small">
          <Waiting>Interview response</Waiting>
          <Text type="secondary">
            Marcus asked for another time for interview 2.
          </Text>
        </Flex>
      }
      stageCard={
        <Card
          title="Design panel interview · current stage"
          extra={
            <RoutePicker
              value="Interview Panel GmbH"
              options={["In-house", "Interview Panel GmbH"]}
            />
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="Interview Panel GmbH schedules these interviews and records feedback. You see everything they record. Changing who performs this stage ends their access to Marcus."
          />
          <Flex orientation="vertical" gap="small">
            <InterviewCard
              title="Interview 1"
              when="Tue, Oct 21, 2026, 10:00 AM SGT · 60 min"
              mode="video"
              where="meet.interviewpanel.example/r/8x2k"
              response={
                <Tag color="success" icon={<CheckOutlined />}>
                  Accepted
                </Tag>
              }
              interviewers={["Jana Koch", "Tobias Wolf"]}
              feedback={<Text type="secondary">After the interview</Text>}
            />
            <InterviewCard
              title="Interview 2"
              when="Mon, Oct 27, 2026, 9:00 AM SGT · 45 min"
              mode="in_person"
              where="Marina Bay Financial Centre, Tower 3, 12F"
              response={<Tag color="warning">Another time requested</Tag>}
              interviewers={["Jana Koch"]}
              feedback={<Text type="secondary">After the interview</Text>}
            />
            <Alert
              type="warning"
              title={`Marcus: "Could we do the afternoon? I'm flying back from Jakarta that morning."`}
            />
          </Flex>
        </Card>
      }
    />
  );
}

function ArunStageCard() {
  return (
    <Card
      title="Hiring manager interview · current stage"
      extra={<RoutePicker value="In-house" options={["In-house"]} />}
    >
      <Flex orientation="vertical" gap="small">
        <InterviewCard
          title="Interview 1"
          when="Fri, Oct 17, 2026, 4:00 PM SGT · 45 min"
          mode="video"
          where="meet.gold.sgp.example.com/hm-arun"
          response={<Tag color="success">Completed</Tag>}
          interviewers={["Anna Lee (you)", "Daniel Ng"]}
          feedback={
            <Flex gap="small" align="center">
              <Tag color="green">Daniel Ng submitted</Tag>
              <Tag color="warning">You: due</Tag>
            </Flex>
          }
          actions={
            <Button type="primary" size="small">
              Submit your feedback
            </Button>
          }
        />
        <Button icon={<PlusOutlined />} style={{ alignSelf: "start" }}>
          Schedule interview
        </Button>
      </Flex>
    </Card>
  );
}

export function FeedbackModal() {
  return (
    <ApplicationFrame
      p="arun"
      n={9}
      state="in_pipeline"
      current={3}
      stageCard={<ArunStageCard />}
      modal={
        <Modal
          open
          title="Your feedback · Interview 1"
          okText="Submit feedback"
          width={600}
        >
          <Paragraph type="secondary">
            Arun Kumar Pillai · Hiring manager interview · Oct 17, 2026
          </Paragraph>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="Other interviewers' feedback appears after you submit yours. You can submit once."
          />
          <Form layout="vertical">
            <Form.Item label="Recommendation" required>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value="yes"
                options={[
                  { value: "strong_yes", label: "Strong yes" },
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "strong_no", label: "Strong no" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="Notes"
              required
              extra="Only your organization sees feedback. The candidate never does."
            >
              <Input.TextArea
                rows={6}
                showCount
                maxLength={10000}
                value={
                  "Strong systems thinking — walked through the merchant onboarding redesign with clear trade-offs.\n\nLess depth on research ops; worth probing in the panel."
                }
              />
            </Form.Item>
          </Form>
        </Modal>
      }
    />
  );
}

export function ScheduleInterviewModal() {
  return (
    <ApplicationFrame
      p="arun"
      n={9}
      state="in_pipeline"
      current={3}
      stageCard={<ArunStageCard />}
      modal={
        <Modal open title="Schedule interview" okText="Schedule" width={640}>
          <Paragraph type="secondary">
            Arun Kumar Pillai · Hiring manager interview · interview 2 of up to
            10
          </Paragraph>
          <Form layout="vertical">
            <Row gutter={16}>
              <Col xs={24} md={14}>
                <Form.Item
                  label="Start"
                  required
                  extra="Shown to Arun in their own time zone."
                >
                  <DatePicker
                    showTime
                    className="full-width"
                    value={dayjs("2026-10-24 14:00")}
                    format="ddd, MMM D, YYYY h:mm A"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item label="Duration" required>
                  <Select
                    value={45}
                    options={[15, 30, 45, 60, 90, 120].map((m) => ({
                      value: m,
                      label: `${m} min`,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Mode" required>
              <Radio.Group
                value="video"
                options={[
                  { value: "video", label: "Video" },
                  { value: "in_person", label: "In person" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="Video link"
              required
              extra="An https:// link the candidate opens to join."
            >
              <Input
                prefix={<LinkOutlined />}
                value="https://meet.gold.sgp.example.com/hm-arun-2"
              />
            </Form.Item>
            <Form.Item
              label="Interviewers"
              required
              extra="1 to 10 active members of your organization. Each submits feedback after the interview."
            >
              <Select
                mode="multiple"
                value={["anna", "ravi"]}
                options={[
                  { value: "anna", label: "Anna Lee (you)" },
                  { value: "ravi", label: "Ravi Menon" },
                ]}
              />
            </Form.Item>
          </Form>
          <Alert
            type="info"
            showIcon
            title="Arun is asked to accept or request another time. Changing the time or mode later asks again."
          />
        </Modal>
      }
    />
  );
}

export function ApplicationSitiBackground() {
  return (
    <ApplicationFrame
      p="siti"
      n={8}
      state="in_pipeline"
      current={4}
      stageCard={
        <Card
          title="Background check · current stage"
          extra={
            <RoutePicker
              value="VerityCheck"
              options={["In-house", "VerityCheck", "Meridian Screening"]}
            />
          }
        >
          <Descriptions
            size="small"
            column={{ xs: 1, md: 2 }}
            style={{ marginBottom: 16 }}
            items={[
              {
                key: "c",
                label: "Consent",
                children: <Tag color="success">Given Oct 16, 2026</Tag>,
              },
              {
                key: "d",
                label: "Disclosure shown",
                children: (
                  <Link>VerityCheck consent disclosure (copied Oct 15)</Link>
                ),
              },
            ]}
          />
          <Table
            size="small"
            pagination={false}
            rowKey="t"
            dataSource={[
              {
                t: "Identity",
                o: <Tag color="success">Clear</Tag>,
                n: "—",
                r: true,
              },
              {
                t: "Employment",
                o: <Tag color="warning">Discrepancy</Tag>,
                n: "Previous employer confirms end date Feb 2022, not Jun 2022 as stated.",
                r: true,
              },
              { t: "Education", o: <Tag>Pending</Tag>, n: "", r: false },
              { t: "Criminal record", o: <Tag>Pending</Tag>, n: "", r: false },
            ]}
            columns={[
              { title: "Check", dataIndex: "t" },
              { title: "Outcome", dataIndex: "o" },
              { title: "Note", dataIndex: "n" },
              {
                title: "Report",
                key: "r",
                render: (_, r) =>
                  r.r ? (
                    <Link>
                      <LinkOutlined /> Report
                    </Link>
                  ) : null,
              },
            ]}
          />
          <Paragraph
            type="secondary"
            style={{ marginTop: 12, marginBottom: 0 }}
          >
            Vetchium records results; it never decides what to do about them.
            That decision is yours.
          </Paragraph>
        </Card>
      }
    />
  );
}

export function ExtendOfferModal() {
  return (
    <ApplicationFrame
      p="marcus"
      n={12}
      state="in_pipeline"
      current={2}
      agency="northstar"
      route="suggested"
      stageCard={
        <Card title="Design panel interview · current stage">
          <Text type="secondary">2 interviews · feedback complete</Text>
        </Card>
      }
      modal={
        <Modal
          open
          title="Extend offer to Marcus Reed"
          okText="Extend offer"
          width={600}
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title="This Opening has 2 positions: 1 person joined and 1 accepted an offer. You can still extend this offer."
          />
          <Form layout="vertical">
            <Form.Item
              label="Offer letter"
              required
              extra="PDF, up to 5 MB. Marcus downloads it from Vetchium."
            >
              <Upload.Dragger
                fileList={[
                  {
                    uid: "1",
                    name: "Offer letter - Marcus Reed.pdf",
                    status: "done",
                    size: 214000,
                  },
                ]}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p>Click or drag a PDF here</p>
              </Upload.Dragger>
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item label="Proposed joining date" extra="Optional.">
                  <DatePicker
                    className="full-width"
                    value={dayjs("2026-12-01")}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="Respond within"
                  required
                  extra="Deadline: Nov 1, 2026. After it, the offer counts as declined."
                >
                  <InputNumber
                    className="full-width"
                    value={14}
                    min={1}
                    max={60}
                    suffix="days"
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Marcus's current stage stays as it is. Upcoming interviews are not
            cancelled.
          </Paragraph>
        </Modal>
      }
    />
  );
}

export function RecordJoiningModal() {
  return (
    <ApplicationFrame
      p="priya"
      n={4}
      state="offer_accepted"
      current={5}
      agency="northstar"
      route="declared"
      side={
        <Flex orientation="vertical" gap="small">
          <Button type="primary" block>
            Record joined on
          </Button>
          <Button block>Record did not join</Button>
          <Button block danger>
            Not progressing
          </Button>
        </Flex>
      }
      stageCard={
        <Card title="Offer">
          <Descriptions
            size="small"
            column={{ xs: 1, md: 2 }}
            items={[
              {
                key: "l",
                label: "Offer letter",
                children: (
                  <Link>
                    <FilePdfOutlined /> Offer letter - Priya Ramachandran.pdf
                  </Link>
                ),
              },
              { key: "e", label: "Extended", children: "Oct 6, 2026" },
              { key: "a", label: "Accepted", children: "Oct 9, 2026" },
              {
                key: "j",
                label: "Proposed joining date",
                children: "Oct 13, 2026",
              },
            ]}
          />
        </Card>
      }
      modal={
        <Modal open title="Record joining" okText="Record joining" width={520}>
          <Form layout="vertical">
            <Form.Item
              label="Joined on"
              required
              extra="Today or earlier, and not before the offer was extended (Oct 6, 2026)."
            >
              <DatePicker className="full-width" value={dayjs("2026-10-13")} />
            </Form.Item>
          </Form>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title="Northstar Talent is credited with this application. The joining date appears on their activity statement."
          />
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            You can correct this date for 90 days. Later you can record a
            separation date within a year of joining.
          </Paragraph>
        </Modal>
      }
    />
  );
}

export function ShortlistModal() {
  return (
    <>
      <OpeningFrame tab="applicants">
        <ApplicantsTab />
      </OpeningFrame>
      <Modal open title="Shortlist Vaidehi" okText="Shortlist" width={560}>
        <Paragraph>
          Vaidehi becomes a candidate. Choose the stage to start at.
        </Paragraph>
        <Form layout="vertical">
          <Form.Item label="Stage" required>
            <Radio.Group
              value={1}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
              options={STAGES.map((s) => ({
                value: s.id,
                label: (
                  <>
                    {s.name}{" "}
                    <Text type="secondary">· {STAGE_KIND[s.kind]}</Text>
                  </>
                ),
              }))}
            />
          </Form.Item>
        </Form>
        <Text type="secondary">
          Vaidehi sees "In review". Stage names stay internal.
        </Text>
      </Modal>
    </>
  );
}

/* ---------- Pipeline templates (HP-PIP-002) ---------- */

const TEMPLATES = [
  {
    name: "Design hiring",
    stages: [
      "Portfolio review",
      "Design exercise",
      "Design panel interview",
      "Hiring manager interview",
      "Background check",
    ],
    updated: "Oct 2, 2026",
  },
  {
    name: "Engineering — senior",
    stages: [
      "Resume review",
      "Coding assessment",
      "System design interview",
      "Team interview",
      "Background check",
    ],
    updated: "Sep 18, 2026",
  },
  {
    name: "Internship",
    stages: ["Application review", "Interview"],
    updated: "Aug 30, 2026",
  },
  {
    name: "Sales",
    stages: ["Review", "Role play interview", "Leadership interview"],
    updated: "Jul 11, 2026",
  },
];

export function TemplatesPage({ drawer = false }: { drawer?: boolean }) {
  return (
    <OrgsShell selected="templates">
      <PageHeader
        title="Pipeline templates"
        extra={
          <Button type="primary" icon={<PlusOutlined />}>
            New template
          </Button>
        }
        intro="Saved stage lists for new Openings. A new Opening copies a template; editing a template later never changes Openings that used it."
      />
      <Card>
        <Flex justify="space-between" style={{ marginBottom: 16 }}>
          <Input.Search placeholder="Search name" style={{ width: 280 }} />
          <Text type="secondary">4 of 50 templates</Text>
        </Flex>
        <Table
          rowKey="name"
          pagination={false}
          dataSource={TEMPLATES}
          columns={[
            {
              title: "Name",
              dataIndex: "name",
              render: (v) => <Link>{v}</Link>,
            },
            {
              title: "Stages",
              key: "s",
              render: (_, r) => (
                <Flex gap={4} wrap>
                  {r.stages.map((s, i) => (
                    <Tag key={s}>
                      {i + 1}. {s}
                    </Tag>
                  ))}
                </Flex>
              ),
            },
            { title: "Updated", dataIndex: "updated" },
            {
              title: "",
              key: "a",
              align: "end",
              render: () => (
                <Flex gap="small" justify="end">
                  <Button size="small">Edit</Button>
                  <Button size="small" type="text" danger>
                    Delete
                  </Button>
                </Flex>
              ),
            },
          ]}
        />
      </Card>
      {drawer ? (
        <Drawer
          open
          title="Edit template"
          size={560}
          extra={
            <Flex gap="small">
              <Button>Cancel</Button>
              <Button type="primary">Save template</Button>
            </Flex>
          }
        >
          <Form layout="vertical">
            <Form.Item
              label="Name"
              required
              extra="Unique in your organization."
            >
              <Input value="Design hiring" />
            </Form.Item>
            <Form.Item
              label="Stages"
              required
              extra="1 to 15 stages, in order. Review stages are always done in-house; others can go to providers."
            >
              <Flex orientation="vertical" gap="small">
                {TEMPLATES[0].stages.map((s, i) => (
                  <Flex key={s} gap="small" align="center">
                    <HolderOutlined />
                    <Input value={s} style={{ flex: 1 }} />
                    <Select
                      value={STAGES[i].kind}
                      style={{ width: 160 }}
                      options={Object.entries(STAGE_KIND).map(
                        ([value, label]) => ({ value, label }),
                      )}
                    />
                    <Button type="text" icon={<DeleteOutlined />} />
                  </Flex>
                ))}
                <Button icon={<PlusOutlined />} style={{ alignSelf: "start" }}>
                  Add stage
                </Button>
              </Flex>
            </Form.Item>
          </Form>
        </Drawer>
      ) : null}
    </OrgsShell>
  );
}

export function OpeningEditorPipeline() {
  return (
    <OrgsShell selected="openings">
      <PageHeader
        crumbs={["Openings", "New Opening"]}
        title="New Opening"
        intro="Describe the role for candidates. You can save an incomplete draft and finish it later."
      />
      <Row gutter={24}>
        <Col xs={24} lg={16}>
          <Card>
            <Flex orientation="vertical" gap="small">
              {[
                "Basics",
                "Location",
                "Role and requirements",
                "Salary",
                "Hiring team and notes",
              ].map((s) => (
                <Card key={s} size="small">
                  <Text>›&nbsp;&nbsp;{s}</Text>
                </Card>
              ))}
              <Card
                size="small"
                title="⌄  Pipeline"
                extra={<Text type="secondary">Internal</Text>}
              >
                <Form layout="vertical">
                  <Form.Item
                    label="Start from"
                    extra="The Opening gets its own copy. You can change its stages any time from the Opening's Pipeline tab."
                  >
                    <Select
                      value="design"
                      options={[
                        { value: "single", label: "One review stage" },
                        { value: "design", label: "Design hiring · 5 stages" },
                        {
                          value: "eng",
                          label: "Engineering — senior · 5 stages",
                        },
                      ]}
                    />
                  </Form.Item>
                </Form>
                <Flex gap={4} wrap>
                  {TEMPLATES[0].stages.map((s, i) => (
                    <Tag key={s}>
                      {i + 1}. {s}
                    </Tag>
                  ))}
                </Flex>
              </Card>
            </Flex>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Actions">
            <Paragraph type="secondary">
              Creating a draft takes one slot of your Opening quota.
            </Paragraph>
            <Button type="primary" block>
              Create draft
            </Button>
          </Card>
        </Col>
      </Row>
    </OrgsShell>
  );
}

/* ---------- Find providers (MKT-UI-001) ---------- */

const LISTINGS: {
  a: AgencyKey;
  headline: string;
  serves: string;
  langs: string;
  price?: string;
  engaged?: boolean;
}[] = [
  {
    a: "lioncity",
    headline: "Design and product hiring across Southeast Asia",
    serves: "Singapore, Malaysia, Indonesia, Vietnam +2",
    langs: "English, Mandarin, Malay",
    price: "From 15% of first-year base salary",
    engaged: true,
  },
  {
    a: "northstar",
    headline: "Senior design and engineering talent for global teams",
    serves: "Worldwide",
    langs: "English, Spanish",
    price: "Retained search; fixed fee per role",
    engaged: true,
  },
  {
    a: "meridian",
    headline: "Executive search for fintech and payments",
    serves: "Singapore, Hong Kong, Australia",
    langs: "English, Cantonese",
  },
  {
    a: "skillproof",
    headline: "Campus and early-career hiring in India",
    serves: "India",
    langs: "English, Hindi, Tamil",
    price: "Per hire, volume pricing on request",
  },
];

export function FindProviders() {
  return (
    <OrgsShell selected="providers">
      <PageHeader
        title="Find providers"
        intro="Search organizations that source candidates, run interviews, assessments, or background checks. Vetchium verifies only that each one controls its domain."
      />
      <Tabs
        activeKey="search"
        items={[
          { key: "search", label: "Search" },
          { key: "eng", label: "Your engagements (6)" },
        ]}
      />
      <Card>
        <Segmented
          value="Sourcing"
          options={[
            "Sourcing",
            "Interviewing",
            "Assessment",
            "Background check",
          ]}
          style={{ marginBottom: 16 }}
        />
        <Flex gap="small" wrap style={{ marginBottom: 16 }}>
          <Input.Search placeholder="Name or headline" style={{ width: 280 }} />
          <Select
            className="filter-select"
            placeholder="Serves country"
            value="SG"
            options={[{ value: "SG", label: "Singapore" }]}
          />
          <Select
            className="filter-select"
            placeholder="Language"
            options={[]}
          />
        </Flex>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="Results may be incomplete: the India (ind1) region didn't answer in time."
          action={<Button size="small">Try again</Button>}
        />
        <Row gutter={[16, 16]}>
          {LISTINGS.map((l) => (
            <Col xs={24} md={12} key={l.a}>
              <Card hoverable>
                <Flex gap="middle" align="start">
                  <OrgLogo
                    name={AGENCIES[l.a].name}
                    color={AGENCIES[l.a].color}
                    size={48}
                  />
                  <Flex orientation="vertical" gap={4} style={{ flex: 1 }}>
                    <Flex justify="space-between" align="center" gap="small">
                      <Text strong style={{ fontSize: 16 }}>
                        {AGENCIES[l.a].name}
                      </Text>
                      {l.engaged ? <Tag color="success">Engaged</Tag> : null}
                    </Flex>
                    <Text type="secondary">
                      {AGENCIES[l.a].domain} · Based in {AGENCIES[l.a].country}
                    </Text>
                    <Text>{l.headline}</Text>
                    <Descriptions
                      size="small"
                      column={1}
                      style={{ marginTop: 8 }}
                      items={[
                        { key: "s", label: "Serves", children: l.serves },
                        { key: "l", label: "Languages", children: l.langs },
                        ...(l.price
                          ? [
                              {
                                key: "p",
                                label: "Indicative price",
                                children: l.price,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </Flex>
                </Flex>
              </Card>
            </Col>
          ))}
        </Row>
        <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
          <Button disabled>Previous</Button>
          <Button>Next</Button>
        </Flex>
      </Card>
    </OrgsShell>
  );
}

export function ListingDetail() {
  return (
    <OrgsShell selected="providers">
      <PageHeader
        crumbs={["Find providers", "Meridian Screening"]}
        title="Meridian Screening"
        tags={<CapabilityTag c="sourcing" />}
        intro="meridianscreening.example · Based in Singapore"
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Card title="Executive search for fintech and payments">
            <Paragraph>
              We place senior product, design and engineering leaders at
              payments companies across APAC. Every search is run by a partner
              with 10+ years in fintech.
            </Paragraph>
            <Title level={5}>How we work</Title>
            <ul>
              <li>Calibration call with the hiring manager within 48 hours</li>
              <li>Shortlist of 5–8 people in three weeks</li>
              <li>
                We suggest Openings to people in Vetchium; they apply themselves
              </li>
            </ul>
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: "s",
                  label: "Serves",
                  children: "Singapore, Hong Kong, Australia",
                },
                {
                  key: "l",
                  label: "Languages",
                  children: "English, Cantonese",
                },
                {
                  key: "p",
                  label: "Indicative price",
                  children: "Retainer plus success fee; quoted per search",
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Propose engagement">
            <Paragraph type="secondary">
              Meridian Screening can accept or decline. A proposal expires after
              30 days. Contracts, prices and payments stay between you and them;
              Vetchium never handles them.
            </Paragraph>
            <Form layout="vertical">
              <Form.Item
                label="Message"
                extra="Optional. Up to 2,000 characters."
              >
                <Input.TextArea
                  rows={4}
                  value="Hi — we're hiring 2 senior product designers in Singapore and would like help with the search."
                />
              </Form.Item>
              <Form.Item
                label="Your reference"
                extra="Optional, such as a PO or contract number. Both sides see it."
              >
                <Input placeholder="PO-2026-…" />
              </Form.Item>
              <Button type="primary" block>
                Propose engagement
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </OrgsShell>
  );
}

export function EngagementsTab() {
  const rows: {
    a: AgencyKey;
    c: string;
    s: string;
    theirs: string;
    ours: string;
    assigned: string;
    since: string;
  }[] = [
    {
      a: "meridian",
      c: "sourcing",
      s: "proposed",
      theirs: "—",
      ours: "—",
      assigned: "—",
      since: "Oct 18, 2026",
    },
    {
      a: "northstar",
      c: "sourcing",
      s: "active",
      theirs: "MSA-NST-044",
      ours: "PO-2026-118",
      assigned: "3 Openings",
      since: "Sep 3, 2026",
    },
    {
      a: "lioncity",
      c: "sourcing",
      s: "active",
      theirs: "LCS/2026/91",
      ours: "PO-2026-121",
      assigned: "1 Opening",
      since: "Sep 10, 2026",
    },
    {
      a: "panel",
      c: "interviewing",
      s: "active",
      theirs: "IP-SOW-12",
      ours: "PO-2026-130",
      assigned: "2 stages",
      since: "Sep 22, 2026",
    },
    {
      a: "skillproof",
      c: "assessment",
      s: "active",
      theirs: "—",
      ours: "PO-2026-131",
      assigned: "1 stage",
      since: "Sep 24, 2026",
    },
    {
      a: "verity",
      c: "background_check",
      s: "active",
      theirs: "VC-ENT-778",
      ours: "PO-2026-099",
      assigned: "4 stages",
      since: "Aug 1, 2026",
    },
  ];
  return (
    <OrgsShell selected="providers">
      <PageHeader
        title="Find providers"
        intro="Search organizations that source candidates, run interviews, assessments, or background checks. Vetchium verifies only that each one controls its domain."
      />
      <Tabs
        activeKey="eng"
        items={[
          { key: "search", label: "Search" },
          { key: "eng", label: "Your engagements (6)" },
        ]}
      />
      <Card>
        <Flex
          justify="space-between"
          wrap
          gap="small"
          style={{ marginBottom: 16 }}
        >
          <Segmented
            value="Open (6)"
            options={[
              "Open (6)",
              "Ended (2)",
              "Declined (1)",
              "Withdrawn (0)",
              "Expired (1)",
            ]}
          />
          <Select
            className="filter-select"
            placeholder="Capability"
            options={[]}
          />
        </Flex>
        <Table
          rowKey="a"
          pagination={false}
          dataSource={rows}
          columns={[
            {
              title: "Provider",
              key: "a",
              render: (_, r) => <Agency a={r.a} />,
            },
            {
              title: "Capability",
              key: "c",
              render: (_, r) => <CapabilityTag c={r.c} />,
            },
            {
              title: "State",
              key: "s",
              render: (_, r) => (
                <Flex orientation="vertical" gap={2}>
                  <EngagementStateTag s={r.s} />
                  {r.s === "proposed" ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Expires Nov 17
                    </Text>
                  ) : null}
                </Flex>
              ),
            },
            { title: "Assigned to", dataIndex: "assigned" },
            { title: "Your reference", dataIndex: "ours" },
            { title: "Their reference", dataIndex: "theirs" },
            { title: "Since", dataIndex: "since" },
          ]}
        />
      </Card>
    </OrgsShell>
  );
}

/* ---------- Engagement detail with activity statement (MKT-UI-004, MKT-STM) ---------- */

export function EngagementDetail({ side }: { side: "consumer" | "provider" }) {
  const consumer = side === "consumer";
  const facts = consumer
    ? [
        {
          d: "Oct 13, 2026",
          f: "Joined",
          o: "#3 Senior product designer",
          a: "#4",
          p: "Priya Ramachandran",
          c: false,
        },
        {
          d: "Oct 6, 2026",
          f: "Joined",
          o: "#12 Staff engineer, payments",
          a: "#21",
          p: "Lukas Müller",
          c: true,
        },
        {
          d: "Oct 2, 2026",
          f: "Separated",
          o: "#7 Researcher",
          a: "#5",
          p: "Removed applicant",
          c: false,
        },
      ]
    : [
        {
          d: "Oct 17, 2026",
          f: "Interview completed",
          o: "#3 Senior product designer",
          a: "#9",
          p: "Arun Kumar Pillai",
          c: false,
        },
        {
          d: "Oct 15, 2026",
          f: "Interview completed",
          o: "#3 Senior product designer",
          a: "#12",
          p: "Marcus Reed",
          c: false,
        },
        {
          d: "Oct 14, 2026",
          f: "No-show",
          o: "#8 Account manager",
          a: "#3",
          p: "Emily Johnson",
          c: false,
        },
        {
          d: "Oct 9, 2026",
          f: "Interview completed",
          o: "#8 Account manager",
          a: "#2",
          p: "Lukas Müller",
          c: false,
        },
      ];
  return (
    <OrgsShell
      kind={consumer ? "consumer" : "provider"}
      selected={consumer ? "providers" : "clients"}
    >
      <PageHeader
        crumbs={
          consumer
            ? ["Find providers", "Your engagements", "Northstar Talent"]
            : ["Clients", CONSUMER.name]
        }
        title={consumer ? "Northstar Talent" : CONSUMER.name}
        tags={
          <>
            <CapabilityTag c={consumer ? "sourcing" : "interviewing"} />
            <EngagementStateTag s="active" />
          </>
        }
        extra={<Button danger>End engagement</Button>}
        intro={
          consumer
            ? "northstar-talent.example · Based in United States · Active since Sep 3, 2026"
            : "gold.sgp.example.com · Based in Singapore · Active since Sep 22, 2026"
        }
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={8}>
          <Flex orientation="vertical" gap="middle">
            <Card title="References">
              <Paragraph type="secondary">
                Your own labels, such as a contract or PO number. Both sides see
                both. Vetchium doesn't interpret them.
              </Paragraph>
              <Descriptions
                column={1}
                size="small"
                items={[
                  {
                    key: "o",
                    label: "Yours",
                    children: (
                      <Flex gap="small">
                        {consumer ? "PO-2026-118" : "IP-SOW-12"}
                        <Link>Edit</Link>
                      </Flex>
                    ),
                  },
                  {
                    key: "t",
                    label: consumer
                      ? "Northstar Talent's"
                      : "Example SGP Gold Corp's",
                    children: consumer ? "MSA-NST-044" : "PO-2026-130",
                  },
                ]}
              />
            </Card>
            <Card title={consumer ? "Assigned Openings" : "Your assignments"}>
              <Flex orientation="vertical" gap="small">
                {(consumer
                  ? [
                      "#3 Senior product designer",
                      "#12 Staff engineer, payments",
                      "#14 Design manager",
                    ]
                  : [
                      "#3 Senior product designer · Design panel interview",
                      "#8 Account manager · Final interview",
                    ]
                ).map((o) => (
                  <Link key={o}>{o}</Link>
                ))}
              </Flex>
            </Card>
            <Card title="Proposal">
              <Descriptions
                column={1}
                size="small"
                items={[
                  {
                    key: "p",
                    label: "Proposed",
                    children: "Sep 1, 2026 by vendors@gold.sgp.example.com",
                  },
                  { key: "a", label: "Accepted", children: "Sep 3, 2026" },
                  {
                    key: "m",
                    label: "Message",
                    children:
                      "We're hiring across design and payments engineering this quarter.",
                  },
                ]}
              />
            </Card>
          </Flex>
        </Col>
        <Col xs={24} lg={16}>
          <Card
            title="Activity statement — not an invoice"
            extra={
              <Flex gap="small">
                <Select
                  value="2026-10"
                  style={{ width: 150 }}
                  options={[{ value: "2026-10", label: "October 2026" }]}
                />
                <Button icon={<DownloadOutlined />}>Export CSV</Button>
              </Flex>
            }
          >
            <Paragraph type="secondary">
              {consumer
                ? "Billable facts recorded under this engagement in the month (UTC). Agree prices, invoices and payments with Northstar Talent outside Vetchium."
                : "Facts you recorded under this engagement in the month (UTC). Agree prices, invoices and payments with your client outside Vetchium."}
            </Paragraph>
            <Table
              size="small"
              rowKey={(r) => r.d + r.a}
              pagination={false}
              dataSource={facts}
              columns={[
                { title: "Date", dataIndex: "d" },
                {
                  title: "Fact",
                  dataIndex: "f",
                  render: (v) => <Tag>{v}</Tag>,
                },
                { title: "Opening", dataIndex: "o" },
                { title: "Application", dataIndex: "a" },
                {
                  title: "Applicant",
                  dataIndex: "p",
                  render: (v) =>
                    v === "Removed applicant" ? (
                      <Text type="secondary">{v}</Text>
                    ) : (
                      v
                    ),
                },
                {
                  title: "",
                  dataIndex: "c",
                  render: (v) =>
                    v ? (
                      <Tooltip title="The date was corrected after it was first recorded.">
                        <Tag color="warning">Corrected</Tag>
                      </Tooltip>
                    ) : null,
                },
              ]}
            />
            <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
              <Button disabled>Previous</Button>
              <Button disabled>Next</Button>
            </Flex>
          </Card>
        </Col>
      </Row>
    </OrgsShell>
  );
}

/* ---------- People: new permissions and presets (MKT-AUTH, HP-AUTH) ---------- */

export function InvitePermissions() {
  const group = (title: string, items: [string, string, boolean][]) => (
    <Card size="small" title={title}>
      <Flex orientation="vertical" gap={6}>
        {items.map(([l, d, c]) => (
          <Checkbox key={l} checked={c}>
            <Text>{l}</Text>{" "}
            <Text type="secondary" style={{ fontSize: 12 }}>
              — {d}
            </Text>
          </Checkbox>
        ))}
      </Flex>
    </Card>
  );
  return (
    <OrgsShell selected="people">
      <PageHeader
        title="People"
        intro="Invite people, choose what each can do, and turn accounts off when they leave."
      />
      <Modal open title="Invite people" okText="Send invitations" width={720}>
        <Form layout="vertical">
          <Form.Item label="Email addresses" required>
            <Select mode="tags" value={["vendors@gold.sgp.example.com"]} />
          </Form.Item>
          <Form.Item
            label="Preset"
            extra="Presets tick the permissions below. Adjust them as you like."
          >
            <Radio.Group
              value="vendor"
              optionType="button"
              options={[
                { value: "recruiter", label: "Recruiter" },
                { value: "approver", label: "Hiring approver" },
                { value: "vendor", label: "Vendor manager" },
                { value: "provider", label: "Provider staff" },
                { value: "users", label: "User manager" },
                { value: "finance", label: "Finance" },
                { value: "member", label: "Member" },
              ]}
            />
          </Form.Item>
          <Flex orientation="vertical" gap="small">
            {group("Openings and hiring", [
              ["View Openings", "read every Opening, drafts included", false],
              [
                "Manage Openings",
                "create and edit Openings, pipelines and templates",
                false,
              ],
              [
                "Approve Openings",
                "publish and decide requests (superadmin only)",
                false,
              ],
              [
                "Manage candidacies",
                "read and act on every Opening's applications",
                false,
              ],
            ])}
            {group("Marketplace", [
              [
                "Manage providers",
                "find providers, propose and end engagements, assign them, read statements",
                true,
              ],
              [
                "Manage listings",
                "edit your Listings, accept or decline clients, read statements",
                false,
              ],
              [
                "Fulfil engagements",
                "do assigned work for clients; agency contacts and messages",
                false,
              ],
            ])}
          </Flex>
        </Form>
      </Modal>
    </OrgsShell>
  );
}

export { Progress, StopOutlined, SearchOutlined };
