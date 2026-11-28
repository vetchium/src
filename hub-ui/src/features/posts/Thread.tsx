import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isBody, MaxBodyLength, type Post } from "typespec/hub/posts/posts";
import type { Reply } from "typespec/hub/posts/replies";
import type { ProfileCard } from "typespec/hub/profile/cards";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { ProfileAvatar } from "../../components/common/ProfileAvatar";
import {
  useEditReplyMutation,
  useHideReplyMutation,
  useLocateReply,
  useProfileCards,
  useRemoveReplyMutation,
  useRepliesQuery,
  useReplyMutation,
} from "./queries";
import { insideEditWindow, relativeTime } from "./time";

interface ThreadContext {
  owner: string;
  postID: string;
  /** The handle of the signed-in user. */
  viewer: string | undefined;
  isPostOwner: boolean;
  /** False when the post is locked or its reply policy is `nobody`. */
  canReply: boolean;
  /** The reply a link names; the thread scrolls to it and highlights it. */
  focusID: string | undefined;
  /** The parent of the focused reply, or `null` when it is top-level. */
  focusParent: string | null | undefined;
}

/** A composer for a reply to the post or to a top-level reply (PST-RPL-002). */
function ReplyComposer({
  ctx,
  parentReplyID,
  onDone,
}: {
  ctx: ThreadContext;
  parentReplyID?: string;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const reply = useReplyMutation();
  const [body, setBody] = useState("");
  const id = `reply-body-${parentReplyID ?? "post"}`;
  const size = [...body].length;
  return (
    <Form
      layout="vertical"
      onFinish={() =>
        reply.mutate(
          {
            owner: ctx.owner,
            post_id: ctx.postID,
            ...(parentReplyID !== undefined && {
              parent_reply_id: parentReplyID,
            }),
            body,
          },
          {
            onSuccess: () => {
              setBody("");
              onDone?.();
            },
          },
        )
      }
    >
      <Flex vertical gap="small">
        <Form.Item
          label={t("posts.thread.composerLabel")}
          htmlFor={id}
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            id={id}
            value={body}
            rows={3}
            onChange={(event) => setBody(event.target.value)}
          />
        </Form.Item>
        <Typography.Text type={size > MaxBodyLength ? "danger" : "secondary"}>
          {t("posts.composer.counter", { count: size, max: MaxBodyLength })}
        </Typography.Text>
        <Flex gap="small">
          <Button
            type="primary"
            htmlType="submit"
            loading={reply.isPending}
            disabled={!isBody(body.trim())}
          >
            {t("posts.thread.submit")}
          </Button>
          {onDone ? (
            <Button onClick={onDone}>{t("common.cancel")}</Button>
          ) : null}
        </Flex>
        <APIErrorAlert error={reply.error} />
      </Flex>
    </Form>
  );
}

/** The reply composer under the post, hidden when replies are closed. */
function PostReplyComposer({ ctx }: { ctx: ThreadContext }) {
  const { t } = useTranslation();
  if (!ctx.canReply) {
    return <Alert type="info" showIcon title={t("posts.thread.closed")} />;
  }
  return <ReplyComposer ctx={ctx} />;
}

function EditReplyForm({
  reply,
  onDone,
}: {
  reply: Reply;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const edit = useEditReplyMutation();
  const [body, setBody] = useState(reply.body ?? "");
  const size = [...body].length;
  const id = `reply-edit-${reply.reply_id}`;
  return (
    <Form
      layout="vertical"
      onFinish={() =>
        edit.mutate(
          { reply_id: reply.reply_id, body, revision: reply.revision },
          { onSuccess: onDone },
        )
      }
    >
      <Flex vertical gap="small">
        <Form.Item
          label={t("posts.thread.editLabel")}
          htmlFor={id}
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            id={id}
            value={body}
            rows={3}
            onChange={(event) => setBody(event.target.value)}
          />
        </Form.Item>
        <Typography.Text type={size > MaxBodyLength ? "danger" : "secondary"}>
          {t("posts.composer.counter", { count: size, max: MaxBodyLength })}
        </Typography.Text>
        <Flex gap="small">
          <Button
            type="primary"
            htmlType="submit"
            loading={edit.isPending}
            disabled={!isBody(body.trim())}
          >
            {t("posts.edit.save")}
          </Button>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
        </Flex>
        <APIErrorAlert error={edit.error} />
      </Flex>
    </Form>
  );
}

function ReplyActions({
  reply,
  ctx,
  top,
  onEdit,
  onReply,
}: {
  reply: Reply;
  ctx: ThreadContext;
  top: boolean;
  onEdit: () => void;
  onReply: () => void;
}) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const remove = useRemoveReplyMutation();
  const hide = useHideReplyMutation();
  const own = ctx.viewer !== undefined && ctx.viewer === reply.author_handle;
  const placeholder = reply.state === "placeholder";
  // Edit controls show only inside the 30-minute window (PST-UI-005).
  const canEdit = own && !placeholder && insideEditWindow(reply.created_at);
  const canHide = ctx.isPostOwner && reply.state === "live";
  const canUnhide = ctx.isPostOwner && reply.state === "hidden";
  const canReplyTo = top && ctx.canReply && reply.state === "live";
  return (
    <Flex vertical gap="small">
      <Space wrap size="small">
        {canReplyTo ? (
          <Button size="small" onClick={onReply}>
            {t("posts.thread.reply")}
          </Button>
        ) : null}
        {canEdit ? (
          <Button size="small" onClick={onEdit}>
            {t("posts.edit.button")}
          </Button>
        ) : null}
        {own && !placeholder ? (
          <Button
            size="small"
            danger
            loading={remove.isPending}
            onClick={() =>
              modal.confirm({
                title: t("posts.thread.removeTitle"),
                content: t("posts.thread.removeContent"),
                okText: t("posts.remove.button"),
                cancelText: t("common.cancel"),
                okButtonProps: { danger: true },
                onOk: () =>
                  remove
                    .mutateAsync(reply)
                    .then(
                      () => void message.success(t("posts.thread.removed")),
                    ),
              })
            }
          >
            {t("posts.remove.button")}
          </Button>
        ) : null}
        {canHide ? (
          <Button
            size="small"
            loading={hide.isPending}
            onClick={() =>
              hide.mutate({
                hide: true,
                post_id: reply.post_id,
                reply_id: reply.reply_id,
              })
            }
          >
            {t("posts.thread.hide")}
          </Button>
        ) : null}
        {canUnhide ? (
          <Button
            size="small"
            loading={hide.isPending}
            onClick={() =>
              hide.mutate({
                hide: false,
                post_id: reply.post_id,
                reply_id: reply.reply_id,
              })
            }
          >
            {t("posts.thread.unhide")}
          </Button>
        ) : null}
      </Space>
      <APIErrorAlert error={remove.error ?? hide.error} />
    </Flex>
  );
}

function ReplyItem({
  reply,
  card,
  ctx,
  top,
}: {
  reply: Reply;
  card: ProfileCard | undefined;
  ctx: ThreadContext;
  top: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  const focused = ctx.focusID === reply.reply_id;
  const [expanded, setExpanded] = useState(false);
  const holdsFocus = top && ctx.focusParent === reply.reply_id;
  useEffect(() => {
    if (holdsFocus) setExpanded(true);
  }, [holdsFocus]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  const placeholder = reply.state === "placeholder";
  const when = relativeTime(i18n.language, reply.created_at);
  return (
    <div ref={ref} id={`reply-${reply.reply_id}`}>
      <Card
        size="small"
        style={
          focused ? { borderColor: "var(--ant-color-primary)" } : undefined
        }
        styles={
          focused ? { body: { background: "var(--ant-color-primary-bg)" } } : {}
        }
      >
        <Flex gap="middle" align="start">
          {placeholder ? null : (
            <ProfileAvatar
              size={32}
              displayName={card?.display_name ?? reply.author_handle}
              src={card?.picture_url}
              alt={t("posts.pictureAlt", {
                name: card?.display_name ?? reply.author_handle,
              })}
            />
          )}
          <Flex vertical gap="small" style={{ flex: 1, minWidth: 0 }}>
            {placeholder ? (
              <Typography.Text type="secondary">
                {t("posts.thread.unavailable")}
              </Typography.Text>
            ) : (
              <>
                <Space size="small" wrap separator={<span>·</span>}>
                  <Link to={`/u/${reply.author_handle}`}>
                    {card ? (
                      <Typography.Text strong>
                        {card.display_name}{" "}
                      </Typography.Text>
                    ) : null}
                    <Typography.Text type="secondary">
                      @{reply.author_handle}
                    </Typography.Text>
                  </Link>
                  <time dateTime={reply.created_at}>{when}</time>
                  {reply.edited ? <Tag>{t("posts.edited")}</Tag> : null}
                  {reply.state === "hidden" ? (
                    <Tag>
                      {ctx.isPostOwner
                        ? t("posts.thread.hiddenLabel")
                        : t("posts.thread.hidden")}
                    </Tag>
                  ) : null}
                </Space>
                {editing ? (
                  <EditReplyForm
                    reply={reply}
                    onDone={() => setEditing(false)}
                  />
                ) : (
                  <Typography.Paragraph
                    style={{
                      marginBottom: 0,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {reply.body}
                  </Typography.Paragraph>
                )}
              </>
            )}
            {editing ? null : (
              <ReplyActions
                reply={reply}
                ctx={ctx}
                top={top}
                onEdit={() => setEditing(true)}
                onReply={() => setComposing(true)}
              />
            )}
            {composing ? (
              <ReplyComposer
                ctx={ctx}
                parentReplyID={reply.reply_id}
                onDone={() => {
                  setComposing(false);
                  setExpanded(true);
                }}
              />
            ) : null}
            {top && reply.child_count > 0 ? (
              <div>
                <Button
                  type="link"
                  size="small"
                  style={{ paddingInline: 0 }}
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded
                    ? t("posts.thread.hideReplies")
                    : t("posts.thread.showReplies", {
                        count: reply.child_count,
                      })}
                </Button>
              </div>
            ) : null}
            {top && expanded ? (
              <div style={{ paddingInlineStart: 16 }}>
                <ReplyList ctx={ctx} parent={reply.reply_id} />
              </div>
            ) : null}
          </Flex>
        </Flex>
      </Card>
    </div>
  );
}

/**
 * One list of replies with Load more. It loads pages until the reply a link
 * names appears in it.
 */
function ReplyList({ ctx, parent }: { ctx: ThreadContext; parent?: string }) {
  const { t } = useTranslation();
  const query = useRepliesQuery(ctx.owner, ctx.postID, parent);
  const replies = query.data?.pages.flatMap((page) => page.replies) ?? [];
  const cards = useProfileCards(
    replies
      .filter((r) => r.state !== "placeholder")
      .map((r) => r.author_handle),
  );
  const target =
    parent === undefined
      ? ctx.focusParent === undefined
        ? undefined
        : (ctx.focusParent ?? ctx.focusID)
      : ctx.focusParent === parent
        ? ctx.focusID
        : undefined;
  const found =
    target === undefined || replies.some((r) => r.reply_id === target);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (!found && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [found, hasNextPage, isFetchingNextPage, fetchNextPage]);
  return (
    <Flex vertical gap="small">
      {query.isError ? <APIErrorAlert error={query.error} /> : null}
      {query.isPending ? (
        <Typography.Text>{t("posts.thread.loading")}</Typography.Text>
      ) : null}
      {query.isSuccess && replies.length === 0 && parent === undefined ? (
        <Typography.Text type="secondary">
          {t("posts.thread.empty")}
        </Typography.Text>
      ) : null}
      {replies.map((reply) => (
        <ReplyItem
          key={reply.reply_id}
          reply={reply}
          card={cards.data?.get(reply.author_handle)}
          ctx={ctx}
          top={parent === undefined}
        />
      ))}
      {hasNextPage ? (
        <Flex justify="center">
          <Button
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t("posts.more")}
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}

/** The replies of a post, with sub-replies, controls, and a focused reply. */
export function Thread({
  post,
  owner,
  viewer,
  focusID,
}: {
  post: Post;
  owner: string;
  viewer: string | undefined;
  focusID: string | undefined;
}) {
  const { t } = useTranslation();
  const locate = useLocateReply(owner, post.post_id, focusID);
  const ctx: ThreadContext = {
    owner,
    postID: post.post_id,
    viewer,
    isPostOwner: viewer !== undefined && viewer === post.owner.handle,
    canReply: !post.locked && post.reply_policy === "everyone",
    focusID,
    focusParent: locate.data === false ? undefined : locate.data,
  };
  return (
    <Flex vertical gap="middle">
      {focusID !== undefined && locate.data === false ? (
        <Alert type="info" showIcon title={t("posts.thread.replyGone")} />
      ) : null}
      <PostReplyComposer ctx={ctx} />
      <ReplyList ctx={ctx} />
    </Flex>
  );
}
