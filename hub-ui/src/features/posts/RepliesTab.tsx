import { Alert, App, Button, Card, Flex, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AuthorReply } from "typespec/hub/posts/replies";
import type { HubHandle } from "typespec/hub/types";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useAuthorRepliesQuery, useRemoveReplyMutation } from "./queries";
import { relativeTime } from "./time";

/**
 * One reply on the Replies tab. It names the post it answers and links to
 * the reply in its thread. Its author can remove it here, also after the post
 * was removed (PST-TAB-004).
 */
function AuthorReplyCard({
  reply,
  isOwner,
}: {
  reply: AuthorReply;
  isOwner: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const remove = useRemoveReplyMutation();
  const when = relativeTime(i18n.language, reply.created_at);
  const removed = reply.state === "post_removed";
  const context = t("posts.thread.tabContext", {
    handle: reply.post_owner_handle,
  });
  return (
    <Card size="small">
      <Flex vertical gap="small">
        <Space size="small" wrap separator={<span>·</span>}>
          {removed ? (
            <Typography.Text type="secondary">{context}</Typography.Text>
          ) : (
            <Link
              to={`/u/${reply.post_owner_handle}/posts/${reply.post_id}/replies/${reply.reply_id}`}
            >
              {context}
            </Link>
          )}
          <time dateTime={reply.created_at}>{when}</time>
          {reply.edited ? <Tag>{t("posts.edited")}</Tag> : null}
          {removed ? <Tag>{t("posts.thread.postRemoved")}</Tag> : null}
        </Space>
        {reply.body === undefined ? null : (
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
        {isOwner ? (
          <Flex>
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
                      .mutateAsync(reply.reply_id)
                      .then(
                        () => void message.success(t("posts.thread.removed")),
                      ),
                })
              }
            >
              {t("posts.remove.button")}
            </Button>
          </Flex>
        ) : null}
        <APIErrorAlert error={remove.error} />
      </Flex>
    </Card>
  );
}

/** The Replies tab of a profile (PST-TAB-001, PST-TAB-002, PST-BLK-005). */
export function RepliesTab({
  handle,
  isOwner,
}: {
  handle: HubHandle;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const replies = useAuthorRepliesQuery(handle);
  const list = replies.data?.pages.flatMap((page) => page.replies) ?? [];
  const muted = replies.data?.pages[0]?.muted === true;
  return (
    <Flex vertical gap="middle">
      {replies.isError ? <APIErrorAlert error={replies.error} /> : null}
      {replies.isPending ? (
        <Typography.Text>{t("posts.thread.loadingTab")}</Typography.Text>
      ) : null}
      {muted ? (
        <Alert type="info" showIcon title={t("posts.muted")} />
      ) : replies.isSuccess && list.length === 0 ? (
        <Typography.Text type="secondary">
          {t("posts.thread.tabEmpty")}
        </Typography.Text>
      ) : (
        list.map((reply) => (
          <AuthorReplyCard
            key={reply.reply_id}
            reply={reply}
            isOwner={isOwner}
          />
        ))
      )}
      {replies.hasNextPage ? (
        <Flex justify="center">
          <Button
            loading={replies.isFetchingNextPage}
            onClick={() => void replies.fetchNextPage()}
          >
            {t("posts.more")}
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}
