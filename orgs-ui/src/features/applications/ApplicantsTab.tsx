import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Alert, Button, Empty, Flex, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ApplicationQuestion } from "typespec/common/openings";
import {
  ApplicantsView,
  type ApplicationSummary,
  isApplicantNameQuery,
} from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import { paths } from "../../app/paths";
import {
  AnswerColumnPicker,
  useAnswerColumns,
  useAnswerTableColumns,
} from "./AnswerColumns";
import { ListPager } from "./ListPager";
import { useListState } from "./listState";
import { NameSearch } from "./NameSearch";
import { NotProgressingDialog } from "./NotProgressingDialog";
import { applicantName, countryName } from "./presentation";
import { useApplicationsQuery } from "./queries";
import { ShortlistDialog } from "./ShortlistDialog";

const pageSize = 25;

interface Props {
  openingNumber: number;
  canAct: boolean;
  /** The Opening's pipeline in order, from its stage counts. */
  stages: readonly PipelineStage[];
  /** The live questions, which answer columns may show. */
  questions: readonly ApplicationQuestion[];
}

type Dialog =
  | { kind: "shortlist"; application: ApplicationSummary }
  | { kind: "not-progressing"; application: ApplicationSummary };

export function ApplicantsTab({
  openingNumber,
  canAct,
  stages,
  questions,
}: Props) {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const list = useListState();
  const [dialog, setDialog] = useState<Dialog>();
  const answers = useAnswerColumns(openingNumber, questions);
  const answerColumns = useAnswerTableColumns(answers.eligible, answers.ids);
  const nameRaw = list.get("q");
  const name =
    nameRaw !== undefined && isApplicantNameQuery(nameRaw)
      ? nameRaw
      : undefined;
  const query = useApplicationsQuery({
    opening_number: openingNumber,
    view: ApplicantsView,
    ...(name !== undefined && { name_query: name }),
    ...(answers.ids.length > 0 && { answer_columns: answers.ids }),
    limit: pageSize,
    ...(list.paginationKey !== undefined && {
      pagination_key: list.paginationKey,
    }),
  });

  const columns: ColumnsType<ApplicationSummary> = [
    {
      title: t("applications.columns.applicant"),
      key: "applicant",
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
          {!application.removed && (
            <Typography.Text type="secondary">
              {countryName(i18n.language, application.resident_country)}
            </Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      title: t("applications.columns.application"),
      key: "number",
      align: "end",
      render: (_, application) => `#${application.application_number}`,
    },
    {
      title: t("applications.columns.applied"),
      key: "applied",
      render: (_, application) => date(application.submitted_at),
    },
    ...answerColumns,
    ...(canAct
      ? [
          {
            title: t("applications.columns.actions"),
            key: "actions",
            align: "end" as const,
            render: (_: unknown, application: ApplicationSummary) => (
              <Space wrap>
                <Button
                  type="primary"
                  size="small"
                  disabled={stages.length === 0}
                  aria-label={t("applications.shortlist.row", {
                    name: applicantName(t, application),
                  })}
                  onClick={() => setDialog({ kind: "shortlist", application })}
                >
                  {t("applications.shortlist.action")}
                </Button>
                <Button
                  size="small"
                  aria-label={t("applications.notProgressing.row", {
                    name: applicantName(t, application),
                  })}
                  onClick={() =>
                    setDialog({ kind: "not-progressing", application })
                  }
                >
                  {t("applications.notProgressing.action")}
                </Button>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <Flex vertical gap="middle">
      <Typography.Text type="secondary">
        {t(
          canAct
            ? "applications.applicantsIntro"
            : "applications.applicantsReadOnly",
        )}
      </Typography.Text>
      <Flex gap="small" wrap align="start">
        <NameSearch
          key={name ?? ""}
          value={name}
          onSearch={(value) => list.set({ q: value })}
        />
        <AnswerColumnPicker
          eligible={answers.eligible}
          ids={answers.ids}
          onChange={answers.choose}
        />
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
                name === undefined
                  ? "applications.applicantsEmpty"
                  : "applications.noMatches",
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
      {dialog?.kind === "shortlist" && (
        <ShortlistDialog
          openingNumber={openingNumber}
          application={dialog.application}
          stages={stages}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "not-progressing" && (
        <NotProgressingDialog
          openingNumber={openingNumber}
          application={dialog.application}
          candidacy={false}
          onClose={() => setDialog(undefined)}
        />
      )}
    </Flex>
  );
}
