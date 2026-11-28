import { Alert, Button, Card, Flex, Space, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AuthorReply } from "typespec/hub/posts/replies";
import type { HubHandle } from "typespec/hub/types";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useAuthorRepliesQuery } from "./queries";
import { relativeTime } from "./time";

function AuthorReplyCard({ reply }: { reply: AuthorReply }) {
  const { t, i18n } = useTranslation();
  const when = relativeTime(i18n.language, reply.created_at);
  const removed = reply.state === "post_removed";
  return (
    <Card size="small">
      <Flex vertical gap="small">
        <Space size="small" wrap separator={<span>·</span>}>
          {removed ? (
            <time dateTime={reply.created_at}>{when}</time>
          ) : (
            <Link
              to={`/u/${reply.post_owner_handle}/posts/${reply.post_id}/replies/${reply.reply_id}`}
            >
              <time dateTime={reply.created_at}>{when}</time>
            </Link>
          )}
          {reply.edited ? <Tag>{t("posts.edited")}</Tag> : null}
          {removed ? <Tag>{t("posts.thread.postRemoved")}</Tag> : null}
        </Space>
        <Typography.Paragraph
          style={{
            marginBottom: 0,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {reply.body}
        </Typography.Paragraph>
      </Flex>
    </Card>
  );
}

/** The Replies tab of a profile (PST-TAB-001, PST-TAB-002, PST-BLK-005). */
export function RepliesTab({ handle }: { handle: HubHandle }) {
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
          <AuthorReplyCard key={reply.reply_id} reply={reply} />
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
