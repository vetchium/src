import {
  CheckCircleFilled,
  ClockCircleOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Avatar, Card, Descriptions, Flex, Tag, Typography } from "antd";
import type { ReactNode } from "react";

export const CONSUMER = {
  name: "Example SGP Gold Corp",
  domain: "gold.sgp.example.com",
  country: "Singapore",
};

export const OPENING = {
  number: 3,
  title: "Senior product designer",
  country: "Singapore",
  arrangement: "Hybrid",
  type: "Full time",
  positions: 2,
};

export const AGENCIES = {
  northstar: {
    name: "Northstar Talent",
    domain: "northstar-talent.example",
    country: "United States",
    color: "#7c3aed",
  },
  lioncity: {
    name: "Lion City Search",
    domain: "lioncitysearch.example",
    country: "Singapore",
    color: "#db2777",
  },
  panel: {
    name: "Interview Panel GmbH",
    domain: "interviewpanel.example",
    country: "Germany",
    color: "#0891b2",
  },
  skillproof: {
    name: "SkillProof",
    domain: "skillproof.example",
    country: "India",
    color: "#ea580c",
  },
  verity: {
    name: "VerityCheck",
    domain: "veritycheck.example",
    country: "India",
    color: "#16a34a",
  },
  meridian: {
    name: "Meridian Screening",
    domain: "meridianscreening.example",
    country: "Singapore",
    color: "#4f46e5",
  },
} as const;
export type AgencyKey = keyof typeof AGENCIES;

export const PEOPLE = {
  marcus: {
    name: "Marcus Reed",
    handle: "marcusreed-k2m9",
    headline: "Senior Product Designer at Stripe",
    country: "United States",
  },
  arun: {
    name: "Arun Kumar Pillai",
    handle: "arunpil-8hq2",
    headline: "Product Designer at Grab",
    country: "Singapore",
  },
  siti: {
    name: "Siti Nurhaliza Yusof",
    handle: "sitinur-x7p1",
    headline: "UX Designer at Shopee",
    country: "Singapore",
  },
  david: {
    name: "David Chen",
    handle: "davidchen-3jr8",
    headline: "Product Designer at Figma",
    country: "United States",
  },
  maithili: {
    name: "Maithili",
    handle: "maithili-p0z4",
    headline: "Interaction Designer at Zoho",
    country: "India",
  },
  rohan: {
    name: "Rohan Verma",
    handle: "rohanv-5tb6",
    headline: "Design Lead at Swiggy",
    country: "India",
  },
  priya: {
    name: "Priya Ramachandran",
    handle: "priyaram-pxfj",
    headline: "Senior UX Designer at DBS",
    country: "Singapore",
  },
  vaidehi: {
    name: "Vaidehi",
    handle: "vaidehi-r1c3",
    headline: "Product Designer at Flipkart",
    country: "India",
  },
  jiahao: {
    name: "Jia Hao Koh",
    handle: "jiahaokoh-q8w2",
    headline: "Visual Designer at Sea",
    country: "Singapore",
  },
  sofia: {
    name: "Sofia Martinez",
    handle: "sofiam-7un4",
    headline: "UX Researcher at Airbnb",
    country: "United States",
  },
  anna: {
    name: "Anna Schmidt",
    handle: "annaschmidt-b3k8",
    headline: "Product Designer at Zalando",
    country: "Germany",
  },
  meiling: {
    name: "Mei Ling Ong",
    handle: "meilingong-z5d1",
    headline: "Product Designer at Carousell",
    country: "Singapore",
  },
  kevin: {
    name: "Kevin Patel",
    handle: "kevinpatel-c9e6",
    headline: "Senior Designer at Adobe",
    country: "United States",
  },
  wei: {
    name: "Wei Jie Tan",
    handle: "weitan-m4n7",
    headline: "Product Designer at Gojek",
    country: "Singapore",
  },
  lukas: {
    name: "Lukas Müller",
    handle: "lukasmueller-h2s5",
    headline: "Software Engineer at SAP",
    country: "Germany",
  },
  emily: {
    name: "Emily Johnson",
    handle: "emilyj-t6y3",
    headline: "Data Scientist at Netflix",
    country: "United States",
  },
} as const;
export type PersonKey = keyof typeof PEOPLE;

const PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
  "#0891b2",
  "#4f46e5",
  "#ca8a04",
];
function colorFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

export function PersonAvatar({
  name,
  size = 32,
}: {
  name: string;
  size?: number;
}) {
  return (
    <Avatar size={size} style={{ background: colorFor(name), flexShrink: 0 }}>
      {initials(name)}
    </Avatar>
  );
}

export function Person({
  p,
  sub,
  size = 32,
}: {
  p: PersonKey;
  sub?: ReactNode;
  size?: number;
}) {
  const person = PEOPLE[p];
  return (
    <Flex gap="small" align="center">
      <PersonAvatar name={person.name} size={size} />
      <Flex orientation="vertical">
        <Typography.Link>{person.name}</Typography.Link>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {sub ?? `${person.headline} · ${person.country}`}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}

export function OrgLogo({
  name,
  color,
  size = 32,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  return (
    <Avatar
      shape="square"
      size={size}
      style={{ background: color ?? colorFor(name), flexShrink: 0 }}
    >
      {initials(name)}
    </Avatar>
  );
}

export function Agency({
  a,
  sub,
  link = true,
}: {
  a: AgencyKey;
  sub?: ReactNode;
  link?: boolean;
}) {
  const agency = AGENCIES[a];
  return (
    <Flex gap="small" align="center">
      <OrgLogo name={agency.name} color={agency.color} size={28} />
      <Flex orientation="vertical">
        {link ? (
          <Typography.Link>{agency.name}</Typography.Link>
        ) : (
          <Typography.Text strong>{agency.name}</Typography.Text>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {sub ?? agency.domain}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}

export const CAPABILITY: Record<string, { label: string; color: string }> = {
  sourcing: { label: "Sourcing", color: "purple" },
  interviewing: { label: "Interviewing", color: "cyan" },
  assessment: { label: "Assessment", color: "orange" },
  background_check: { label: "Background check", color: "green" },
};
export function CapabilityTag({ c }: { c: keyof typeof CAPABILITY }) {
  return (
    <Tag color={CAPABILITY[c].color} variant="outlined">
      {CAPABILITY[c].label}
    </Tag>
  );
}

export const STAGE_KIND: Record<string, string> = {
  review: "Review",
  assessment: "Assessment",
  interview: "Interview",
  background_check: "Background check",
};

/** Orgs-side application states (hiring-pipeline.md States). */
export function AppStateTag({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    submitted: ["Applicant", "blue"],
    in_pipeline: ["In pipeline", "processing"],
    offered: ["Offered", "gold"],
    offer_accepted: ["Offer accepted", "green"],
    joined: ["Joined", "success"],
    did_not_join: ["Did not join", "default"],
    offer_declined: ["Offer declined", "default"],
    not_progressing: ["Not progressing", "default"],
    withdrawn: ["Withdrawn", "default"],
  };
  const [label, color] = map[s];
  return <Tag color={color}>{label}</Tag>;
}

/** Hub-visible status (HP-HUB-001). */
export function HubStatusTag({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    applied: ["Applied", "blue"],
    in_review: ["In review", "processing"],
    interviewing: ["Interviewing", "purple"],
    offer: ["Offer", "gold"],
    hired: ["Hired", "success"],
    not_progressing: ["Not progressing", "default"],
    withdrawn: ["Withdrawn", "default"],
  };
  const [label, color] = map[s];
  return <Tag color={color}>{label}</Tag>;
}

export function RouteTag({ r }: { r: "suggested" | "declared" }) {
  return r === "suggested" ? (
    <Tag color="purple" variant="outlined">
      Suggested
    </Tag>
  ) : (
    <Tag variant="outlined">Declared</Tag>
  );
}

export function EngagementStateTag({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    proposed: ["Proposed", "gold"],
    active: ["Active", "success"],
    declined: ["Declined", "default"],
    withdrawn: ["Withdrawn", "default"],
    expired: ["Expired", "default"],
    ended: ["Ended", "default"],
  };
  const [label, color] = map[s];
  return <Tag color={color}>{label}</Tag>;
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <Tag icon={<ClockCircleOutlined />} color="warning">
      {children}
    </Tag>
  );
}

/** The immutable profile snapshot an application carries (HP-APP-002). */
export function SnapshotCard({
  p,
  title = "Profile at application",
  extra,
  live = false,
}: {
  p: PersonKey;
  title?: string;
  extra?: ReactNode;
  /** The live profile view, not an application's snapshot. */
  live?: boolean;
}) {
  const person = PEOPLE[p];
  return (
    <Card title={title} extra={extra}>
      <Flex gap="middle" align="center" style={{ marginBottom: 16 }}>
        <PersonAvatar name={person.name} size={48} />
        <Flex orientation="vertical">
          <Typography.Text strong style={{ fontSize: 16 }}>
            {person.name}
          </Typography.Text>
          <Typography.Text type="secondary">{person.headline}</Typography.Text>
        </Flex>
      </Flex>
      <Descriptions
        column={1}
        size="small"
        items={[
          { key: "c", label: "Resident country", children: person.country },
          {
            key: "w",
            label: "Work experience",
            children: (
              <Flex orientation="vertical">
                <span>
                  {person.headline.replace(" at ", ", ")} · Mar 2021 – present
                </span>
                <Typography.Text type="secondary">
                  Product Designer, Foodpanda · Jul 2018 – Feb 2021
                </Typography.Text>
              </Flex>
            ),
          },
          {
            key: "e",
            label: "Education",
            children: "B.Des Interaction Design, NUS · 2014 – 2018",
          },
          {
            key: "l",
            label: "Languages",
            children: "English (speaking, writing), Malay (speaking)",
          },
          {
            key: "s",
            label: "Websites",
            children: (
              <Typography.Link>
                <LinkOutlined /> dribbble.example.com/{person.handle}
              </Typography.Link>
            ),
          },
        ]}
      />
      {live ? null : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Captured on Oct 2, 2026 when they applied. Later profile changes do
          not appear here.
        </Typography.Text>
      )}
    </Card>
  );
}

export function CoverNote({ text }: { text?: string }) {
  return (
    <Card title="Cover note">
      <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
        {text ??
          "I've spent five years designing payments and checkout flows used by millions of people across Southeast Asia. Your work on cross-border hiring is close to what I care about — making complicated systems feel calm.\n\nI'd love to talk about how I ran the redesign of our merchant onboarding, which cut drop-off by 31%."}
      </Typography.Paragraph>
    </Card>
  );
}

/** The Hub presentation of an Opening (OPN-ORG-004 preview component). */
export function OpeningContent({ compact = false }: { compact?: boolean }) {
  return (
    <Flex orientation="vertical" gap={4}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        About the role
      </Typography.Title>
      <Typography.Paragraph>
        Join the team designing how companies across Asia hire. You will own
        end-to-end flows for candidates and recruiters, from first idea to
        shipped product.
      </Typography.Paragraph>
      <ul style={{ marginTop: 0 }}>
        <li>Lead design for the candidate experience</li>
        <li>Partner with research, product, and engineering</li>
        <li>Mentor two mid-level designers</li>
      </ul>
      {compact ? null : (
        <Descriptions
          column={{ xs: 1, md: 2 }}
          size="small"
          layout="vertical"
          items={[
            { key: "1", label: "Country", children: "Singapore" },
            { key: "2", label: "Work arrangement", children: "Hybrid" },
            {
              key: "3",
              label: "Location details",
              children: "Marina Bay office, three days a week",
            },
            { key: "4", label: "Employment type", children: "Full time" },
            { key: "5", label: "Positions", children: "2" },
            { key: "6", label: "Experience", children: "5–10 years" },
            {
              key: "7",
              label: "Salary",
              children: "SGD 8,000–11,000 per month",
            },
            { key: "8", label: "Language", children: "English" },
          ]}
        />
      )}
    </Flex>
  );
}

export function ProviderNotice({ a, what }: { a: AgencyKey; what: string }) {
  const agency = AGENCIES[a];
  return (
    <Flex gap="small" align="center">
      <SafetyCertificateOutlined />
      <Typography.Text type="secondary">
        {what} is performed by{" "}
        <Typography.Text strong>{agency.name}</Typography.Text> ({agency.domain}
        ) for {CONSUMER.name}.
      </Typography.Text>
    </Flex>
  );
}

export const Done = () => <CheckCircleFilled style={{ color: "#16a34a" }} />;
