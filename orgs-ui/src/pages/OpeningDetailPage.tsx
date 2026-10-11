import { CopyOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { OpeningContentView } from "@vetchium/portal-ui/openings";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Space,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type { PaginationKey } from "typespec/common/pagination";
import { holds, ManageOpenings } from "typespec/orgs/authorization/types";
import type { OpeningTeamUser } from "typespec/orgs/openings/types";
import { isDefiniteRefusal } from "../api/client";
import { paths } from "../app/paths";
import { problemMessage } from "../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../components/common/useDateTimeFormat";
import { useMyInfoQuery } from "../features/account/queries";
import { openingContentPresentation } from "../features/openings/presentation";
import { openingProblem } from "../features/openings/problems";
import {
  useDiscardOpeningMutation,
  useDiscardOpeningWorkingCopyMutation,
  useDuplicateOpeningMutation,
  useOpeningHistoryQuery,
  useOpeningQuery,
} from "../features/openings/queries";

export function OpeningDetailPage() {
  const { number: numberText } = useParams();
  const number = Number(numberText);
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const formatDateTime = useDateTimeFormat();
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState<string>();
  const { data: me } = useMyInfoQuery();
  const query = useOpeningQuery(number);
  const history = useOpeningHistoryQuery({
    opening_number: number,
    limit: 25,
    ...(pageKeys[pageIndex] ? { pagination_key: pageKeys[pageIndex] } : {}),
  });
  const duplicate = useDuplicateOpeningMutation();
  const discardWorking = useDiscardOpeningWorkingCopyMutation();
  const discard = useDiscardOpeningMutation();
  const duplicateKey = useIdempotencyKey(`opening-duplicate:${number}`);
  const discardWorkingKey = useIdempotencyKey(
    `opening-discard-working:${number}`,
  );
  const discardKey = useIdempotencyKey(`opening-discard:${number}`);
  const opening = query.data;
  const canManage = me !== undefined && holds(me.permissions, ManageOpenings);
  const editable =
    canManage &&
    opening !== undefined &&
    ["draft", "published", "paused"].includes(opening.state) &&
    !["publish", "revise"].includes(opening.pending_request?.kind ?? "");
  const discardable = opening?.pending_request === undefined;
  const teamEditable =
    canManage &&
    opening !== undefined &&
    ["draft", "published", "paused"].includes(opening.state);
  const presentation = openingContentPresentation(t, i18n.language);
  const publicURL =
    me && opening
      ? `https://vetchium.com/org/${encodeURIComponent(me.org.domain.domain)}/openings/${opening.opening_number}`
      : undefined;

  const report = (cause: unknown, rotate: () => void) => {
    const problem = openingProblem(cause);
    if (problem.kind === "version-conflict") {
      void query.refetch();
      setError(t("openings.errors.versionConflict"));
    } else if (problem.kind === "quota-exceeded") {
      setError(
        t("openings.errors.quota", {
          quota: problem.quota,
          count: problem.count,
        }),
      );
    } else {
      setError(problemMessage(t, cause));
    }
    if (isDefiniteRefusal(cause)) rotate();
  };
  const doDuplicate = async () => {
    if (!opening) return;
    try {
      const created = await duplicate.mutateAsync({
        request: { opening_number: number },
        key: duplicateKey.current(),
      });
      duplicateKey.rotate();
      navigate(paths.openingDetail(created.opening_number));
    } catch (cause) {
      report(cause, duplicateKey.rotate);
    }
  };
  const doDiscardWorking = async () => {
    if (!opening) return;
    try {
      await discardWorking.mutateAsync({
        request: { opening_number: number, version: opening.version },
        key: discardWorkingKey.current(),
      });
      discardWorkingKey.rotate();
      void message.success(t("openings.discardedWorking"));
    } catch (cause) {
      report(cause, discardWorkingKey.rotate);
    }
  };
  const doDiscard = async () => {
    if (!opening) return;
    try {
      await discard.mutateAsync({
        request: { opening_number: number, version: opening.version },
        key: discardKey.current(),
      });
      discardKey.rotate();
      void message.success(t("openings.discardedDraft"));
    } catch (cause) {
      report(cause, discardKey.rotate);
    }
  };
  const confirmDiscard = (working: boolean) =>
    modal.confirm({
      title: t(
        working
          ? "openings.confirmDiscardWorking"
          : "openings.confirmDiscardDraft",
      ),
      okText: t(working ? "openings.discardWorking" : "openings.discardDraft"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: () => (working ? doDiscardWorking() : doDiscard()),
    });
  const teamUser = (member: OpeningTeamUser | undefined) =>
    member ? (
      <>
        {member.email}
        {!member.active && (
          <Tag color="warning">{t("openings.disabledMember")}</Tag>
        )}
      </>
    ) : (
      t("openings.notSet")
    );

  if (!Number.isInteger(number) || number <= 0)
    return <Alert type="error" title={t("openings.notFound")} />;
  if (query.isLoading)
    return <Typography.Text>{t("common.loading")}</Typography.Text>;
  if (query.isError || !opening)
    return (
      <Alert
        type="error"
        title={t("openings.notFound")}
        action={
          <Button onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("openings.detailTitle", { number })}</title>
      <Flex justify="space-between" align="center" wrap gap="small">
        <div>
          <Link to={paths.openings}>{t("openings.backToList")}</Link>
          <Typography.Title level={1}>
            {opening.working_content?.title ??
              opening.live_content?.title ??
              t("openings.untitled")}{" "}
            <Typography.Text type="secondary">#{number}</Typography.Text>
          </Typography.Title>
        </div>
        <Flex gap="small" wrap>
          {editable && (
            <Link to={paths.openingEdit(number)}>
              <Button icon={<EditOutlined />} aria-label={t("openings.edit")}>
                {t("openings.edit")}
              </Button>
            </Link>
          )}
          {canManage && opening.state !== "discarded" && (
            <Button
              icon={<CopyOutlined />}
              aria-label={t("openings.duplicate")}
              onClick={() => void doDuplicate()}
              loading={duplicate.isPending}
            >
              {t("openings.duplicate")}
            </Button>
          )}
          {editable && discardable && opening.state === "draft" && (
            <Button
              danger
              icon={<DeleteOutlined />}
              aria-label={t("openings.discardDraft")}
              onClick={() => confirmDiscard(false)}
            >
              {t("openings.discardDraft")}
            </Button>
          )}
          {editable &&
            opening.pending_request?.kind !== "revise" &&
            opening.state !== "draft" &&
            opening.working_content && (
              <Button danger onClick={() => confirmDiscard(true)}>
                {t("openings.discardWorking")}
              </Button>
            )}
        </Flex>
      </Flex>
      {error && (
        <Alert
          type="error"
          title={error}
          closable
          onClose={() => setError(undefined)}
        />
      )}
      <Descriptions
        bordered
        column={1}
        size="small"
        items={[
          {
            key: "state",
            label: t("openings.fields.state"),
            children: t(`openings.states.${opening.state}`),
          },
          {
            key: "revision",
            label: t("openings.revision"),
            children: opening.revision,
          },
          {
            key: "expiry",
            label: t("openings.expiresAt"),
            children: opening.expires_at
              ? formatDateTime(opening.expires_at)
              : t("openings.notSet"),
          },
          {
            key: "request",
            label: t("openings.pendingRequest"),
            children: opening.pending_request
              ? `${t(`openings.requestKinds.${opening.pending_request.kind}`)} — ${opening.pending_request.requested_by_email} · ${formatDateTime(opening.pending_request.requested_at)}`
              : t("openings.notSet"),
          },
        ]}
      />
      {publicURL && (
        <Card title={t("openings.publicURL")}>
          <Flex gap="small" align="center" wrap>
            <Typography.Text copyable={{ text: publicURL }}>
              {publicURL}
            </Typography.Text>
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(publicURL)
                  .then(() => message.success(t("openings.copied")))
                  .catch(() => message.error(t("openings.copyFailed")))
              }
            >
              {t("openings.copyURL")}
            </Button>
          </Flex>
        </Card>
      )}
      <Flex gap="large" wrap align="start">
        {opening.live_content && (
          <Card title={t("openings.liveContent")} style={{ flex: "1 1 360px" }}>
            <OpeningContentView
              content={opening.live_content}
              {...presentation}
            />
          </Card>
        )}
        {opening.working_content && (
          <Card
            title={
              opening.state === "draft"
                ? t("openings.draftContent")
                : t("openings.workingContent")
            }
            style={{ flex: "1 1 360px" }}
          >
            <OpeningContentView
              content={opening.working_content}
              {...presentation}
            />
          </Card>
        )}
      </Flex>
      <Card
        title={t("openings.editor.team")}
        extra={
          teamEditable && (
            <Link to={paths.openingEdit(number)}>{t("openings.editTeam")}</Link>
          )
        }
      >
        <Descriptions
          column={1}
          items={[
            {
              key: "manager",
              label: t("openings.fields.hiringManager"),
              children: teamUser(opening.hiring_manager),
            },
            {
              key: "recruiter",
              label: t("openings.editor.recruiter"),
              children: teamUser(opening.recruiter),
            },
            {
              key: "members",
              label: t("openings.editor.teamMembers"),
              children: opening.team_members.length ? (
                <Space wrap>
                  {opening.team_members.map((member) => (
                    <span key={member.email}>{teamUser(member)}</span>
                  ))}
                </Space>
              ) : (
                t("openings.notSet")
              ),
            },
            {
              key: "notes",
              label: t("openings.editor.internalNotes"),
              children: opening.internal_notes ?? t("openings.notSet"),
            },
          ]}
        />
      </Card>
      <Card title={t("openings.history")} loading={history.isLoading}>
        {history.isError && (
          <Alert
            type="error"
            title={t("common.loadError")}
            action={
              <Button onClick={() => void history.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        )}
        <ol>
          {history.data?.entries.map((entry) => (
            <li key={`${entry.version}-${entry.created_at}`}>
              <Typography.Text>
                {formatDateTime(entry.created_at)} ·{" "}
                {t(`openings.historyActions.${entry.action}`, {
                  defaultValue: entry.action,
                })}{" "}
                · {entry.actor_email ?? t("openings.systemActor")}
                {entry.request_kind
                  ? ` · ${t(`openings.requestKinds.${entry.request_kind}`)}`
                  : ""}
                {entry.request_state
                  ? ` · ${t(`openings.requestStates.${entry.request_state}`)}`
                  : ""}
                {entry.request_note ? ` · ${entry.request_note}` : ""}
                {entry.decision_note ? ` · ${entry.decision_note}` : ""}
              </Typography.Text>
            </li>
          ))}
        </ol>
        <Flex justify="end" gap="small">
          <Button
            disabled={pageIndex === 0 || history.isFetching}
            onClick={() => setPageIndex(pageIndex - 1)}
          >
            {t("common.previous")}
          </Button>
          <Button
            disabled={!history.data?.next_pagination_key || history.isFetching}
            onClick={() => {
              const key = history.data?.next_pagination_key;
              if (key) {
                setPageKeys((old) => [...old.slice(0, pageIndex + 1), key]);
                setPageIndex(pageIndex + 1);
              }
            }}
          >
            {t("common.next")}
          </Button>
        </Flex>
      </Card>
    </Space>
  );
}
