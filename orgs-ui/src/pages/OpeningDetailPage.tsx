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
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type { PaginationKey } from "typespec/common/pagination";
import {
  ApproveOpenings,
  holds,
  ManageOpenings,
} from "typespec/orgs/authorization/types";
import type {
  OpeningRequestKind,
  OpeningTeamUser,
} from "typespec/orgs/openings/types";
import { isDefiniteRefusal } from "../api/client";
import { paths } from "../app/paths";
import { problemMessage } from "../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../components/common/useDateTimeFormat";
import { useMyInfoQuery } from "../features/account/queries";
import { openingContentPresentation } from "../features/openings/presentation";
import { openingProblem } from "../features/openings/problems";
import {
  publicationFieldLabels,
  publicationGaps,
} from "../features/openings/publication";
import {
  useDecideOpeningRequestMutation,
  useDiscardOpeningMutation,
  useDiscardOpeningWorkingCopyMutation,
  useDuplicateOpeningMutation,
  useOpeningHistoryQuery,
  useOpeningQuery,
  useRequestOpeningChangeMutation,
  useWithdrawOpeningRequestMutation,
} from "../features/openings/queries";

interface PageError {
  title: string;
  items?: string[];
}

function ItemList({ items }: { items: readonly string[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ErrorAlert({
  error,
  onClose,
}: {
  error: PageError;
  onClose: () => void;
}) {
  return (
    <Alert
      type="error"
      title={error.title}
      description={error.items && <ItemList items={error.items} />}
      closable
      onClose={onClose}
    />
  );
}

type OpeningAction =
  | { kind: "request"; requestKind: OpeningRequestKind }
  | { kind: "approve" | "reject" };

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
  const [error, setError] = useState<PageError>();
  const [action, setAction] = useState<OpeningAction>();
  const [actionNote, setActionNote] = useState("");
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
  const requestChange = useRequestOpeningChangeMutation();
  const decide = useDecideOpeningRequestMutation();
  const withdraw = useWithdrawOpeningRequestMutation();
  const duplicateKey = useIdempotencyKey(`opening-duplicate:${number}`);
  const discardWorkingKey = useIdempotencyKey(
    `opening-discard-working:${number}`,
  );
  const discardKey = useIdempotencyKey(`opening-discard:${number}`);
  const requestKey = useIdempotencyKey(`opening-request:${number}`);
  const decideKey = useIdempotencyKey(`opening-decide:${number}`);
  const withdrawKey = useIdempotencyKey(`opening-withdraw:${number}`);
  const opening = query.data;
  const canManage = me !== undefined && holds(me.permissions, ManageOpenings);
  const canApprove = me !== undefined && holds(me.permissions, ApproveOpenings);
  const actionBusy =
    requestChange.isPending || decide.isPending || withdraw.isPending;
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
      setError({ title: t("openings.errors.versionConflict") });
    } else if (problem.kind === "quota-exceeded") {
      setError({
        title: t("openings.errors.quota", {
          quota: problem.quota,
          count: problem.count,
        }),
      });
    } else if (problem.kind === "incomplete") {
      setError({
        title: t("openings.errors.incomplete"),
        items: publicationFieldLabels(t, problem.fields),
      });
    } else if (problem.kind === "hiring-team-invalid") {
      setError({
        title: t("openings.errors.invalidTeam", {
          addresses: problem.emailAddresses.join(", "),
        }),
      });
    } else {
      setError({ title: problemMessage(t, cause) });
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
  const requestKinds: OpeningRequestKind[] =
    opening?.state === "draft"
      ? ["publish"]
      : opening?.state === "published"
        ? [
            ...(opening.working_content ? ["revise" as const] : []),
            "pause",
            "close",
          ]
        : opening?.state === "paused"
          ? [
              ...(opening.working_content ? ["revise" as const] : []),
              "reopen",
              "close",
            ]
          : [];
  const availableKinds = opening?.pending_request
    ? canApprove && ["published", "paused"].includes(opening.state)
      ? (["close"] as OpeningRequestKind[])
      : []
    : requestKinds;
  const missingForPublication =
    opening && canManage && opening.pending_request === undefined
      ? publicationFieldLabels(t, publicationGaps(opening))
      : [];
  const openAction = (next: OpeningAction) => {
    setAction(next);
    setActionNote("");
    setError(undefined);
  };
  const submitAction = async () => {
    if (!opening || !action || actionBusy) return;
    const note = actionNote.trim();
    if (
      [...note].length > 2000 ||
      (action.kind === "reject" && note.length === 0)
    )
      return;
    try {
      if (action.kind === "request") {
        await requestChange.mutateAsync({
          request: {
            opening_number: number,
            version: opening.version,
            kind: action.requestKind,
            ...(note && { note }),
          },
          key: requestKey.current(),
        });
        requestKey.rotate();
      } else {
        await decide.mutateAsync({
          request: {
            opening_number: number,
            version: opening.version,
            decision: action.kind,
            ...(note && { note }),
          },
          key: decideKey.current(),
        });
        decideKey.rotate();
      }
      setAction(undefined);
      void message.success(t("openings.actions.saved"));
    } catch (cause) {
      report(
        cause,
        action.kind === "request" ? requestKey.rotate : decideKey.rotate,
      );
    }
  };
  const doWithdraw = async () => {
    if (!opening || actionBusy) return;
    try {
      await withdraw.mutateAsync({
        request: { opening_number: number, version: opening.version },
        key: withdrawKey.current(),
      });
      withdrawKey.rotate();
      void message.success(t("openings.actions.withdrawn"));
    } catch (cause) {
      report(cause, withdrawKey.rotate);
    }
  };
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
      {error && action === undefined && (
        <ErrorAlert error={error} onClose={() => setError(undefined)} />
      )}
      {(canManage || canApprove) && (
        <Card title={t("openings.actions.title")}>
          <Flex vertical gap="middle">
            {missingForPublication.length > 0 && (
              <Alert
                type="warning"
                showIcon
                title={t("openings.publicationMissing")}
                description={<ItemList items={missingForPublication} />}
              />
            )}
            <Flex gap="small" wrap>
              {canManage &&
                availableKinds.map((kind) => (
                  <Button
                    key={kind}
                    onClick={() =>
                      openAction({ kind: "request", requestKind: kind })
                    }
                    disabled={actionBusy}
                  >
                    {canApprove
                      ? t(`openings.actions.effects.${kind}`)
                      : t("openings.actions.submitForApproval", {
                          action: t(`openings.actions.effects.${kind}`),
                        })}
                  </Button>
                ))}
              {opening.pending_request && canApprove && (
                <>
                  <Button
                    type="primary"
                    onClick={() => openAction({ kind: "approve" })}
                    disabled={actionBusy}
                  >
                    {t("openings.actions.approve")}
                  </Button>
                  <Button
                    danger
                    onClick={() => openAction({ kind: "reject" })}
                    disabled={actionBusy}
                  >
                    {t("openings.actions.reject")}
                  </Button>
                </>
              )}
              {opening.pending_request && canManage && (
                <Button
                  onClick={() => void doWithdraw()}
                  loading={withdraw.isPending}
                  disabled={actionBusy}
                >
                  {t("openings.actions.withdraw")}
                </Button>
              )}
            </Flex>
          </Flex>
        </Card>
      )}
      {opening.pending_request && (
        <Card title={t("openings.pendingRequest")}>
          <Descriptions
            column={1}
            items={[
              {
                key: "kind",
                label: t("openings.actions.requestKind"),
                children: t(
                  `openings.requestKinds.${opening.pending_request.kind}`,
                ),
              },
              {
                key: "requester",
                label: t("openings.actions.requester"),
                children: opening.pending_request.requested_by_email,
              },
              {
                key: "time",
                label: t("openings.actions.requestedAt"),
                children: formatDateTime(opening.pending_request.requested_at),
              },
              {
                key: "note",
                label: t("openings.actions.note"),
                children: opening.pending_request.note ?? t("openings.notSet"),
              },
            ]}
          />
        </Card>
      )}
      <Descriptions
        bordered
        column={1}
        size="small"
        items={[
          {
            key: "state",
            label: t("openings.fields.state"),
            children: t(`openings.states.${opening.state}`, {
              defaultValue: opening.state,
            }),
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
              ? `${t(`openings.requestKinds.${opening.pending_request.kind}`, { defaultValue: opening.pending_request.kind })} — ${opening.pending_request.requested_by_email} · ${formatDateTime(opening.pending_request.requested_at)}`
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
            <li key={`${entry.created_at}-${entry.version}-${entry.action}`}>
              <Typography.Text>
                {formatDateTime(entry.created_at)} ·{" "}
                {t(`openings.historyActions.${entry.action}`, {
                  defaultValue: entry.action,
                })}{" "}
                · {entry.actor_email ?? t("openings.systemActor")}
                {entry.request_kind
                  ? ` · ${t(`openings.requestKinds.${entry.request_kind}`, { defaultValue: entry.request_kind })}`
                  : ""}
                {entry.request_state
                  ? ` · ${t(`openings.requestStates.${entry.request_state}`, { defaultValue: entry.request_state })}`
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
      <Modal
        title={
          action?.kind === "request"
            ? canApprove
              ? t(`openings.actions.effects.${action.requestKind}`)
              : t("openings.actions.submitForApproval", {
                  action: t(`openings.actions.effects.${action.requestKind}`),
                })
            : action
              ? t(`openings.actions.${action.kind}`)
              : undefined
        }
        open={action !== undefined}
        onCancel={() => {
          if (!actionBusy) setAction(undefined);
        }}
        onOk={() => void submitAction()}
        closable={!actionBusy}
        keyboard={!actionBusy}
        cancelButtonProps={{ disabled: actionBusy }}
        okText={
          action?.kind === "request" && !canApprove
            ? t("openings.actions.submit")
            : t("common.confirm")
        }
        okButtonProps={{
          disabled:
            (action?.kind === "reject" && !actionNote.trim()) ||
            [...actionNote.trim()].length > 2000,
          loading: actionBusy,
        }}
        destroyOnHidden
      >
        {error && (
          <ErrorAlert error={error} onClose={() => setError(undefined)} />
        )}
        {((action?.kind === "request" &&
          ["pause", "close"].includes(action.requestKind)) ||
          (action?.kind === "approve" &&
            ["pause", "close"].includes(
              opening.pending_request?.kind ?? "",
            ))) && (
          <Alert
            type="warning"
            title={t(
              `openings.actions.consequences.${action?.kind === "request" ? action.requestKind : opening.pending_request?.kind}`,
            )}
          />
        )}
        <Typography.Paragraph>
          {t(
            action?.kind === "reject"
              ? "openings.actions.rejectNote"
              : "openings.actions.optionalNote",
          )}
        </Typography.Paragraph>
        <Input.TextArea
          aria-label={t("openings.actions.note")}
          value={actionNote}
          onChange={(event) => setActionNote(event.target.value)}
          disabled={actionBusy}
          rows={4}
        />
      </Modal>
    </Space>
  );
}
