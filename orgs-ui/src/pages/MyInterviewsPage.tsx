import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Button,
  Empty,
  Flex,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { MyInterview } from "typespec/orgs/applications/applications";
import { paths } from "../app/paths";
import { ListPager } from "../features/applications/ListPager";
import { useListState } from "../features/applications/listState";
import { useMyInterviewsQuery } from "../features/applications/queries";

/**
 * The interviews the caller sits on, newest first, wherever they work in the
 * Org. It is how an interviewer with no other hiring access finds the
 * applications they may open.
 */
export function MyInterviewsPage() {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const list = useListState();
  const query = useMyInterviewsQuery({
    limit: 25,
    ...(list.paginationKey !== undefined && {
      pagination_key: list.paginationKey,
    }),
  });

  const columns = [
    {
      title: t("myInterviews.columns.applicant"),
      key: "applicant",
      render: (_: unknown, row: MyInterview) => (
        <Link
          to={paths.application(row.opening_number, row.application_number)}
        >
          {row.display_name}
        </Link>
      ),
    },
    {
      title: t("myInterviews.columns.when"),
      key: "when",
      render: (_: unknown, row: MyInterview) => (
        <Flex vertical>
          <Typography.Text>{dateTime(row.starts_at)}</Typography.Text>
          <Typography.Text type="secondary">
            {t("myInterviews.minutes", { minutes: row.duration_minutes })}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("myInterviews.columns.mode"),
      key: "mode",
      render: (_: unknown, row: MyInterview) =>
        t(`applications.work.modes.${row.mode}`),
    },
    {
      title: t("myInterviews.columns.state"),
      key: "state",
      render: (_: unknown, row: MyInterview) => (
        <Flex gap="small" wrap>
          <Tag>
            {t(`applications.work.interviewStates.${row.state}`, {
              defaultValue: row.state,
            })}
          </Tag>
          {row.state === "scheduled" && (
            <Tag
              color={
                row.applicant_response === "pending" ? "warning" : undefined
              }
            >
              {t(`applications.work.responses.${row.applicant_response}`, {
                defaultValue: row.applicant_response,
              })}
            </Tag>
          )}
        </Flex>
      ),
    },
    {
      title: t("myInterviews.columns.feedback"),
      key: "feedback",
      render: (_: unknown, row: MyInterview) =>
        row.feedback_submitted ? (
          <Tag color="success">{t("myInterviews.feedbackGiven")}</Tag>
        ) : row.state === "completed" ? (
          <Tag color="warning">{t("myInterviews.feedbackDue")}</Tag>
        ) : (
          <Typography.Text type="secondary">
            {t("myInterviews.feedbackNotYet")}
          </Typography.Text>
        ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("myInterviews.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("myInterviews.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("myInterviews.description")}
        </Typography.Text>
      </div>
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
        rowKey={(row) =>
          `${row.opening_number}-${row.application_number}-${row.interview_number}`
        }
        loading={query.isLoading}
        dataSource={query.data?.interviews ?? []}
        columns={columns}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("myInterviews.empty")}
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
    </Space>
  );
}
