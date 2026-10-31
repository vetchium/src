import type { UseQueryResult } from "@tanstack/react-query";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Card,
  Col,
  Empty,
  Flex,
  List,
  Row,
  Statistic,
  Tag,
  Typography,
} from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  FeedbackDueInterviewsView,
  type MyInterview,
  UpcomingInterviewsView,
} from "typespec/orgs/applications/applications";
import {
  ApproveOpenings,
  FulfilEngagements,
  holds,
  ManageAI,
  ManageBilling,
  ManageListings,
  ManageOpenings,
  ManageProviders,
} from "typespec/orgs/authorization/types";
import {
  type Capability,
  Sourcing,
} from "typespec/orgs/marketplace/capabilities";
import type { OrgOpeningSummary } from "typespec/orgs/openings/types";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import { overallCreditUse } from "../features/ai/creditUse";
import { useAICreditsQuery } from "../features/ai/queries";
import {
  useMyInterviewCountsQuery,
  useMyInterviewsQuery,
} from "../features/applications/queries";
import {
  capabilityColors,
  capabilityLabel,
  openingStateColors,
  openingStateLabel,
} from "../features/marketplace/presentation";
import {
  useClientEngagementsQuery,
  useConsumerEngagementsQuery,
  useContactsQuery,
  useJobsQuery,
  useWorkQueueQuery,
} from "../features/marketplace/queries";
import { useOpeningsQuery } from "../features/openings/queries";
import { SEAT_WARNING_PERCENT } from "../features/subscriptions/CurrentSubscriptionCard";
import { useMySubscriptionQuery } from "../features/subscriptions/queries";

const previewSize = 5;

// Live Openings and drafts on their way to being live; ended ones need
// nothing from their team.
const runningStates = ["draft", "published", "paused"] as const;

/**
 * What waits on the signed-in person, from every role they hold: interviews,
 * approvals, the Openings they run, and their marketplace work, with alerts
 * for limits they can fix. A card shows only to a user it can apply to.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const can = (permission: Parameters<typeof holds>[1]) =>
    me !== undefined && holds(me.permissions, permission);
  const capabilities = me?.marketplace.capabilities ?? [];
  const canFulfil = can(FulfilEngagements);
  const isAgent = capabilities.includes(Sourcing) && canFulfil;
  // Where a card's "See all" goes when its first item names no Capability.
  // Sourcing has Jobs instead of a work queue.
  const provided = capabilities[0];
  const providedWork = capabilities.find(
    (capability) => capability !== Sourcing,
  );

  const interviewCounts = useMyInterviewCountsQuery();
  const unread = useContactsQuery({ filter: "unread", limit: 1 }, isAgent);
  if (me === undefined) return null;

  return (
    <Flex orientation="vertical" gap="large">
      <title>{t("home.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("home.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("home.description")}
        </Typography.Text>
      </div>

      <LimitAlerts
        manageBilling={can(ManageBilling)}
        manageAI={can(ManageAI)}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <CountCard
            testId="home-upcoming-count"
            title={t("home.upcomingInterviews")}
            value={interviewCounts.data?.upcoming}
            failed={interviewCounts.isError}
            link={`${paths.myInterviews}?tab=${UpcomingInterviewsView}`}
          />
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <CountCard
            testId="home-feedback-due-count"
            title={t("home.feedbackDue")}
            value={interviewCounts.data?.feedback_due}
            failed={interviewCounts.isError}
            link={`${paths.myInterviews}?tab=${FeedbackDueInterviewsView}`}
          />
        </Col>
        {isAgent ? (
          <Col xs={24} sm={12} lg={8}>
            <CountCard
              testId="home-unread-count"
              title={t("home.unreadConversations")}
              value={unread.data?.counts.unread}
              failed={unread.isError}
              link={`${paths.contacts}?tab=unread`}
            />
          </Col>
        ) : null}
      </Row>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <InterviewsCard view={UpcomingInterviewsView} />
        </Col>
        <Col xs={24} lg={12}>
          <InterviewsCard view={FeedbackDueInterviewsView} />
        </Col>
        {can(ApproveOpenings) ? (
          <Col xs={24} lg={12}>
            <ApprovalsCard />
          </Col>
        ) : null}
        <OpeningsYouRunCard
          email={me.email_address}
          always={can(ManageOpenings)}
        />
        {isAgent ? (
          <Col xs={24} lg={12}>
            <JobsCard email={me.email_address} />
          </Col>
        ) : null}
        {canFulfil && providedWork !== undefined ? (
          <Col xs={24} lg={12}>
            <WorkCard capability={providedWork} />
          </Col>
        ) : null}
        {can(ManageListings) && provided !== undefined ? (
          <Col xs={24} lg={12}>
            <ClientRequestsCard capability={provided} />
          </Col>
        ) : null}
        {can(ManageProviders) ? (
          <Col xs={24} lg={12}>
            <ProposalsCard />
          </Col>
        ) : null}
      </Row>
    </Flex>
  );
}

function CountCard({
  testId,
  title,
  value,
  failed,
  link,
}: {
  testId: string;
  title: string;
  value: number | undefined;
  failed: boolean;
  link: string;
}) {
  const { t } = useTranslation();
  return (
    <Card data-testid={testId}>
      <Statistic
        title={<Link to={link}>{title}</Link>}
        value={failed ? t("home.unavailable") : (value ?? t("common.loading"))}
      />
    </Card>
  );
}

/** A card listing the first few items of one list, linking to the rest. */
function PreviewCard<Item>({
  testId,
  title,
  seeAll,
  query,
  items,
  empty,
  footer,
  renderItem,
}: {
  testId: string;
  title: string;
  seeAll: string;
  query: Pick<UseQueryResult, "isLoading" | "isError">;
  items: Item[];
  empty: string;
  footer?: ReactNode;
  renderItem: (item: Item) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card
      title={title}
      data-testid={testId}
      extra={<Link to={seeAll}>{t("home.seeAll")}</Link>}
      loading={query.isLoading}
    >
      {query.isError ? (
        <Alert type="error" title={t("common.loadError")} />
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
      ) : (
        <List
          dataSource={items.slice(0, previewSize)}
          renderItem={(item) => <List.Item>{renderItem(item)}</List.Item>}
        />
      )}
      {footer}
    </Card>
  );
}

function InterviewsCard({
  view,
}: {
  view: typeof UpcomingInterviewsView | typeof FeedbackDueInterviewsView;
}) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const upcoming = view === UpcomingInterviewsView;
  const query = useMyInterviewsQuery({ view, limit: previewSize });
  const note = (interview: MyInterview): ReactNode => {
    if (!upcoming) {
      return interview.state === "scheduled" ? (
        <Tag color="warning">{t("myInterviews.outcomeDue")}</Tag>
      ) : (
        <Tag color="warning">{t("myInterviews.feedbackDue")}</Tag>
      );
    }
    return interview.applicant_response === "accepted" ? null : (
      <Tag
        color={interview.applicant_response === "pending" ? "warning" : "error"}
      >
        {t(`applications.work.responses.${interview.applicant_response}`, {
          defaultValue: interview.applicant_response,
        })}
      </Tag>
    );
  };
  return (
    <PreviewCard
      testId={upcoming ? "home-upcoming" : "home-feedback-due"}
      title={upcoming ? t("home.upcomingInterviews") : t("home.feedbackDue")}
      seeAll={`${paths.myInterviews}?tab=${view}`}
      query={query}
      items={query.data?.interviews ?? []}
      empty={upcoming ? t("home.noUpcoming") : t("home.noFeedbackDue")}
      renderItem={(interview) => (
        <List.Item.Meta
          title={
            <Flex gap="small" wrap align="center">
              <Link
                to={paths.application(
                  interview.opening_number,
                  interview.application_number,
                )}
              >
                {interview.display_name}
              </Link>
              {note(interview)}
            </Flex>
          }
          description={`${dateTime(interview.starts_at)} · ${t(
            `applications.work.modes.${interview.mode}`,
            { defaultValue: interview.mode },
          )}`}
        />
      )}
    />
  );
}

function OpeningItem({ opening }: { opening: OrgOpeningSummary }) {
  const { t } = useTranslation();
  return (
    <List.Item.Meta
      title={
        // In a Flex, as in the other cards, so the title keeps link colour.
        <Flex>
          <Link to={paths.openingDetail(opening.opening_number)}>
            {opening.title ?? t("openings.untitled")}
          </Link>
        </Flex>
      }
      description={
        <Flex gap="small" wrap>
          <Tag color={openingStateColors[opening.state]}>
            {openingStateLabel(t, opening.state)}
          </Tag>
          {opening.pending_request_kind ? (
            <Tag color="gold">
              {t("openings.pendingTag", {
                kind: t(
                  `openings.requestKinds.${opening.pending_request_kind}`,
                  { defaultValue: opening.pending_request_kind },
                ),
              })}
            </Tag>
          ) : null}
        </Flex>
      }
    />
  );
}

function ApprovalsCard() {
  const { t } = useTranslation();
  const query = useOpeningsQuery({
    awaiting_my_approval: true,
    limit: previewSize,
  });
  return (
    <PreviewCard
      testId="home-approvals"
      title={t("home.approvals")}
      seeAll={paths.openings}
      query={query}
      items={query.data?.openings ?? []}
      empty={t("home.noApprovals")}
      renderItem={(opening) => <OpeningItem opening={opening} />}
    />
  );
}

/**
 * The Openings naming the person as hiring manager or recruiter. Anyone can
 * be named, so without the right to manage Openings the card shows only when
 * it has one.
 */
function OpeningsYouRunCard({
  email,
  always,
}: {
  email: string;
  always: boolean;
}) {
  const { t } = useTranslation();
  const asManager = useOpeningsQuery({
    hiring_manager_email: email,
    states: [...runningStates],
    limit: previewSize,
  });
  const asRecruiter = useOpeningsQuery({
    recruiter_email: email,
    states: [...runningStates],
    limit: previewSize,
  });
  const openings = [
    ...new Map(
      [
        ...(asManager.data?.openings ?? []),
        ...(asRecruiter.data?.openings ?? []),
      ].map((opening) => [opening.opening_number, opening]),
    ).values(),
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (!always && openings.length === 0) return null;
  return (
    <Col xs={24} lg={12}>
      <PreviewCard
        testId="home-openings"
        title={t("home.openingsYouRun")}
        seeAll={paths.openings}
        query={{
          isLoading: asManager.isLoading || asRecruiter.isLoading,
          isError: asManager.isError || asRecruiter.isError,
        }}
        items={openings}
        empty={t("home.noOpenings")}
        renderItem={(opening) => <OpeningItem opening={opening} />}
      />
    </Col>
  );
}

function JobsCard({ email }: { email: string }) {
  const { t } = useTranslation();
  const query = useJobsQuery({ owner_email: email, limit: previewSize });
  return (
    <PreviewCard
      testId="home-jobs"
      title={t("home.myJobs")}
      seeAll={paths.jobs}
      query={query}
      items={query.data?.jobs ?? []}
      empty={t("home.noJobs")}
      renderItem={(job) => (
        <List.Item.Meta
          title={
            <Link to={paths.jobDetail(job.engagement_id, job.opening.number)}>
              {job.opening.title}
            </Link>
          }
          description={job.client.display_name}
        />
      )}
    />
  );
}

function WorkCard({ capability }: { capability: Capability }) {
  const { t } = useTranslation();
  const query = useWorkQueueQuery({ status: "pending", limit: previewSize });
  const items = query.data?.items ?? [];
  return (
    <PreviewCard
      testId="home-work"
      title={t("home.workToStart")}
      seeAll={paths.workQueue(items[0]?.capability ?? capability)}
      query={query}
      items={items}
      empty={t("home.noWork")}
      footer={
        (query.data?.unavailable_tenants.length ?? 0) > 0 ? (
          <Typography.Text type="secondary">
            {t("home.workIncomplete")}
          </Typography.Text>
        ) : null
      }
      renderItem={(item) => (
        <List.Item.Meta
          title={
            <Flex gap="small" wrap align="center">
              <Link
                to={paths.workItem(
                  item.capability,
                  item.engagement_id,
                  item.work_id,
                )}
              >
                {item.applicant_name}
              </Link>
              <Tag color={capabilityColors[item.capability]}>
                {capabilityLabel(t, item.capability)}
              </Tag>
            </Flex>
          }
          description={`${item.opening.title} · ${item.client.display_name}`}
        />
      )}
    />
  );
}

function ClientRequestsCard({ capability }: { capability: Capability }) {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const query = useClientEngagementsQuery({
    state: "proposed",
    limit: previewSize,
  });
  const engagements = query.data?.engagements ?? [];
  return (
    <PreviewCard
      testId="home-client-requests"
      title={t("home.clientRequests")}
      seeAll={paths.clients(engagements[0]?.capability ?? capability)}
      query={query}
      items={engagements}
      empty={t("home.noClientRequests")}
      renderItem={(engagement) => (
        <List.Item.Meta
          title={
            <Flex gap="small" wrap align="center">
              <Link
                to={paths.clientEngagementDetail(
                  engagement.capability,
                  engagement.id,
                )}
              >
                {engagement.counterparty.display_name}
              </Link>
              <Tag color={capabilityColors[engagement.capability]}>
                {capabilityLabel(t, engagement.capability)}
              </Tag>
            </Flex>
          }
          description={t("home.answerBy", {
            date: date(engagement.expires_at),
          })}
        />
      )}
    />
  );
}

function ProposalsCard() {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const query = useConsumerEngagementsQuery({
    state: "proposed",
    limit: previewSize,
  });
  return (
    <PreviewCard
      testId="home-proposals"
      title={t("home.proposals")}
      seeAll={`${paths.findProviders}?tab=engagements&state=proposed`}
      query={query}
      items={query.data?.engagements ?? []}
      empty={t("home.noProposals")}
      renderItem={(engagement) => (
        <List.Item.Meta
          title={
            <Flex gap="small" wrap align="center">
              <Link to={paths.engagementDetail(engagement.id)}>
                {engagement.counterparty.display_name}
              </Link>
              <Tag color={capabilityColors[engagement.capability]}>
                {capabilityLabel(t, engagement.capability)}
              </Tag>
            </Flex>
          }
          description={t("home.expiresOn", {
            date: date(engagement.expires_at),
          })}
        />
      )}
    />
  );
}

/** Warns the people who can fix them of limits the Org is close to. */
function LimitAlerts({
  manageBilling,
  manageAI,
}: {
  manageBilling: boolean;
  manageAI: boolean;
}) {
  const { t } = useTranslation();
  const subscription = useMySubscriptionQuery(manageBilling);
  const credits = useAICreditsQuery(manageAI);
  const alerts: ReactNode[] = [];

  const seats = subscription.data;
  if (seats?.seat_limit !== undefined && seats.seat_limit > 0) {
    const percent = Math.floor((seats.seats_in_use * 100) / seats.seat_limit);
    if (percent >= SEAT_WARNING_PERCENT) {
      const full = seats.seats_in_use >= seats.seat_limit;
      alerts.push(
        <Alert
          key="seats"
          data-testid="home-seats-alert"
          type={full ? "error" : "warning"}
          showIcon
          title={
            full
              ? t("home.seatsFull", { limit: seats.seat_limit })
              : t("home.seatsNearlyFull", {
                  used: seats.seats_in_use,
                  limit: seats.seat_limit,
                })
          }
          action={<Link to={paths.plans}>{t("home.changePlan")}</Link>}
        />,
      );
    }
  }

  const use = credits.data && overallCreditUse(credits.data.balance);
  if (use !== undefined && use.level !== "normal") {
    alerts.push(
      <Alert
        key="credits"
        data-testid="home-credits-alert"
        type={use.level === "exhausted" ? "error" : "warning"}
        showIcon
        title={
          use.level === "exhausted"
            ? t("home.creditsExhausted")
            : t("home.creditsLow", { percent: use.percent })
        }
        action={<Link to={paths.ai}>{t("home.openAI")}</Link>}
      />,
    );
  }

  return alerts.length === 0 ? null : (
    <Flex orientation="vertical" gap="small">
      {alerts}
    </Flex>
  );
}
