import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Button,
  Empty,
  Flex,
  Select,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  type ApplicationCounts,
  type ApplicationState,
  type ApplicationSummary,
  CandidatesView,
  isApplicantNameQuery,
  isPendingApplicantAction,
  pendingApplicantActionValues,
} from "typespec/orgs/applications/applications";
import { isPipelineStageID } from "typespec/orgs/hiring/pipelines";
import { paths } from "../../app/paths";
import { FilterCard } from "./FilterCard";
import { ListPager } from "./ListPager";
import { useListState } from "./listState";
import { NameSearch } from "./NameSearch";
import {
  activeStates,
  applicantName,
  countryName,
  finishedStates,
  stageKindLabel,
  stateColors,
  stateLabel,
} from "./presentation";
import { useApplicationsQuery } from "./queries";

const pageSize = 25;
const activeView = "active";
const stateCards = ["offered", "offer_accepted"] as const;

interface Props {
  openingNumber: number;
  counts: ApplicationCounts | undefined;
}

function isFinished(value: string | undefined): value is ApplicationState {
  return (
    value !== undefined && (finishedStates as readonly string[]).includes(value)
  );
}

export function CandidatesTab({ openingNumber, counts }: Props) {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const list = useListState();
  const viewParam = list.get("view");
  const finished = isFinished(viewParam) ? viewParam : undefined;
  const active = finished === undefined;
  const stageRaw = list.get("stage");
  const stageParam =
    active && stageRaw !== undefined && isPipelineStageID(stageRaw)
      ? stageRaw
      : undefined;
  const onlyParam = list.get("only");
  const only = active
    ? stateCards.find((state) => state === onlyParam)
    : undefined;
  const pendingParam = list.get("pending");
  const pending =
    active && isPendingApplicantAction(pendingParam) ? pendingParam : undefined;
  const nameRaw = list.get("q");
  const name =
    nameRaw !== undefined && isApplicantNameQuery(nameRaw)
      ? nameRaw
      : undefined;
  const states: ApplicationState[] | undefined = finished
    ? [finished]
    : only
      ? [only]
      : undefined;
  const query = useApplicationsQuery({
    opening_number: openingNumber,
    view: CandidatesView,
    ...(states && { states }),
    ...(stageParam !== undefined && { stage_id: stageParam }),
    ...(name !== undefined && { name_query: name }),
    ...(pending !== undefined && { pending_applicant_action: pending }),
    limit: pageSize,
    ...(list.paginationKey !== undefined && {
      pagination_key: list.paginationKey,
    }),
  });

  const stateCount = (state: ApplicationState) =>
    counts?.states.find((entry) => entry.state === state)?.count ?? 0;
  const activeCount = activeStates.reduce(
    (sum, state) => sum + stateCount(state),
    0,
  );
  const filtered =
    stageParam !== undefined ||
    only !== undefined ||
    pending !== undefined ||
    name !== undefined;
  const clear = () =>
    list.set({
      stage: undefined,
      only: undefined,
      pending: undefined,
      q: undefined,
    });

  const columns: ColumnsType<ApplicationSummary> = [
    {
      title: t("applications.columns.candidate"),
      key: "candidate",
      render: (_, application) => (
        <Flex vertical>
          <Link
            to={paths.application(
              openingNumber,
              application.application_number,
            )}
          >
            {applicantName(t, application)}
          </Link>
          <Typography.Text type="secondary">
            {[
              `#${application.application_number}`,
              ...(application.removed
                ? []
                : [countryName(i18n.language, application.resident_country)]),
            ].join(" · ")}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("applications.columns.stage"),
      key: "stage",
      render: (_, application) =>
        application.current_stage ? (
          <Flex vertical>
            <Typography.Text>{application.current_stage.name}</Typography.Text>
            <Typography.Text type="secondary">
              {stageKindLabel(t, application.current_stage.kind)}
            </Typography.Text>
          </Flex>
        ) : (
          <Typography.Text type="secondary">
            {t("applications.noStage")}
          </Typography.Text>
        ),
    },
    {
      title: t("applications.columns.status"),
      key: "status",
      render: (_, application) => (
        <Tag color={stateColors[application.state]}>
          {stateLabel(t, application.state)}
        </Tag>
      ),
    },
    {
      title: t("applications.columns.applied"),
      key: "applied",
      render: (_, application) => date(application.submitted_at),
    },
    {
      title: t("applications.columns.updated"),
      key: "updated",
      render: (_, application) => date(application.updated_at),
    },
  ];

  return (
    <Flex vertical gap="middle">
      {active && counts && (
        <Flex
          gap="small"
          wrap
          role="group"
          aria-label={t("applications.stageCards")}
        >
          <FilterCard
            title={t("applications.allActive")}
            value={activeCount}
            selected={stageParam === undefined && only === undefined}
            onSelect={() => list.set({ stage: undefined, only: undefined })}
          />
          {counts.stages.map((entry, index) => (
            <FilterCard
              key={entry.stage.id}
              title={`${index + 1}. ${entry.stage.name}`}
              caption={stageKindLabel(t, entry.stage.kind)}
              value={entry.count}
              selected={stageParam === entry.stage.id}
              onSelect={() =>
                list.set({ stage: entry.stage.id, only: undefined })
              }
            />
          ))}
          {stateCards.map((state) => (
            <FilterCard
              key={state}
              title={stateLabel(t, state)}
              caption={t(`applications.stateCaptions.${state}`)}
              value={stateCount(state)}
              selected={only === state}
              onSelect={() => list.set({ only: state, stage: undefined })}
            />
          ))}
        </Flex>
      )}
      <Tabs
        activeKey={finished ?? activeView}
        onChange={(key) =>
          list.set({
            view: key === activeView ? undefined : key,
            stage: undefined,
            only: undefined,
            pending: undefined,
          })
        }
        items={[
          {
            key: activeView,
            label: t("applications.viewWithCount", {
              state: t("applications.active"),
              count: activeCount,
            }),
          },
          ...finishedStates.map((state) => ({
            key: state,
            label: t("applications.viewWithCount", {
              state: stateLabel(t, state),
              count: stateCount(state),
            }),
          })),
        ]}
      />
      <Flex gap="small" wrap align="start">
        <NameSearch
          key={name ?? ""}
          value={name}
          onSearch={(value) => list.set({ q: value })}
        />
        {active && (
          <Select
            allowClear
            className="toolbar-select"
            style={{ minWidth: 220 }}
            aria-label={t("applications.pending.label")}
            placeholder={t("applications.pending.label")}
            value={pending}
            onChange={(value) => list.set({ pending: value })}
            options={pendingApplicantActionValues.map((value) => ({
              value,
              label: t(`applications.pending.${value}`),
            }))}
          />
        )}
        {filtered && (
          <Button type="link" onClick={clear}>
            {t("applications.clearFilters")}
          </Button>
        )}
      </Flex>
      {query.isError && (
        <Alert
          type="error"
          showIcon
          title={t("common.loadError")}
          action={
            <Button onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      )}
      <Table
        rowKey="application_number"
        loading={query.isLoading}
        dataSource={query.data?.applications ?? []}
        columns={columns}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                filtered
                  ? "applications.noMatches"
                  : active
                    ? "applications.candidatesEmpty"
                    : "applications.finishedEmpty",
              )}
            />
          ),
        }}
      />
      <ListPager
        hasPrevious={list.pageIndex > 0}
        hasNext={query.data?.next_pagination_key !== undefined}
        busy={query.isFetching}
        onPrevious={list.previous}
        onNext={() => {
          const key = query.data?.next_pagination_key;
          if (key) list.next(key);
        }}
      />
    </Flex>
  );
}
