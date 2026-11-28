import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Skeleton,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import {
  isBody,
  isPostID,
  MaxBodyLength,
  type Post,
  type QuotePolicy,
  type ReplyPolicy,
} from "typespec/hub/posts/posts";
import { isProfileAddress } from "typespec/hub/profile/public";
import { HubPostNotFoundError } from "typespec/problem/hub/posts";
import { isProblem } from "../api/client";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { PostCard } from "../features/posts/PostCard";
import { PolicySelect } from "../features/posts/PostComposer";
import {
  useEditPostMutation,
  usePostQuery,
  useRemovePostMutation,
  useSetPostPoliciesMutation,
} from "../features/posts/queries";
import { insideEditWindow } from "../features/posts/time";
import { useMyInfoQuery } from "../features/profile/queries";

function EditForm({ post, onDone }: { post: Post; onDone: () => void }) {
  const { t } = useTranslation();
  const edit = useEditPostMutation();
  const [body, setBody] = useState(post.body);
  const size = [...body].length;
  return (
    <Form
      layout="vertical"
      onFinish={() =>
        edit.mutate(
          { post_id: post.post_id, body, revision: post.revision },
          { onSuccess: onDone },
        )
      }
    >
      <Flex vertical gap="small">
        <Form.Item label={t("posts.edit.label")} style={{ marginBottom: 0 }}>
          <Input.TextArea
            value={body}
            rows={4}
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

function PolicyForm({ post }: { post: Post }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const save = useSetPostPoliciesMutation();
  const [replyPolicy, setReplyPolicy] = useState<ReplyPolicy>(
    post.reply_policy,
  );
  const [quotePolicy, setQuotePolicy] = useState<QuotePolicy>(
    post.quote_policy,
  );
  const [locked, setLocked] = useState(post.locked);
  return (
    <Card size="small" title={t("posts.policy.title")}>
      <Form
        layout="vertical"
        onFinish={() =>
          save.mutate(
            {
              post_id: post.post_id,
              reply_policy: replyPolicy,
              quote_policy: quotePolicy,
              locked,
            },
            { onSuccess: () => void message.success(t("posts.policy.saved")) },
          )
        }
      >
        <Flex vertical gap="small">
          <Typography.Text type="secondary">
            {t("posts.policy.help")}
          </Typography.Text>
          <Flex gap="middle" wrap align="end">
            <PolicySelect
              label={t("posts.replyPolicy")}
              value={replyPolicy}
              onChange={(value) => setReplyPolicy(value)}
            />
            <PolicySelect
              label={t("posts.quotePolicy")}
              value={quotePolicy}
              onChange={(value) => setQuotePolicy(value)}
            />
            <Form.Item
              label={t("posts.policy.lock")}
              style={{ marginBottom: 0 }}
            >
              <Switch checked={locked} onChange={setLocked} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              {t("posts.policy.save")}
            </Button>
          </Flex>
          <APIErrorAlert error={save.error} />
        </Flex>
      </Form>
    </Card>
  );
}

function OwnerControls({ post }: { post: Post }) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const remove = useRemovePostMutation();
  const [editing, setEditing] = useState(false);
  const canEdit = insideEditWindow(post.created_at);
  return (
    <Flex vertical gap="middle">
      {editing ? (
        <Card size="small">
          <EditForm post={post} onDone={() => setEditing(false)} />
        </Card>
      ) : (
        <Flex gap="small" wrap>
          {canEdit ? (
            <Button onClick={() => setEditing(true)}>
              {t("posts.edit.button")}
            </Button>
          ) : null}
          <Button
            danger
            loading={remove.isPending}
            onClick={() =>
              modal.confirm({
                title: t("posts.remove.title"),
                content: t("posts.remove.content"),
                okText: t("posts.remove.button"),
                cancelText: t("common.cancel"),
                okButtonProps: { danger: true },
                onOk: () =>
                  remove.mutateAsync(post).then(() => {
                    void message.success(t("posts.remove.done"));
                    void navigate(`/u/${post.owner.handle}`, { replace: true });
                  }),
              })
            }
          >
            {t("posts.remove.button")}
          </Button>
        </Flex>
      )}
      <APIErrorAlert error={remove.error} />
      <PolicyForm
        key={`${post.reply_policy}-${post.quote_policy}-${post.locked}`}
        post={post}
      />
    </Flex>
  );
}

export function PostPage() {
  return (
    <>
      <NoIndex />
      <PostView />
    </>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <Alert
      type="warning"
      showIcon
      title={t("posts.notFound.title")}
      description={t("posts.notFound.description")}
    />
  );
}

function PostView() {
  const { t } = useTranslation();
  const params = useParams();
  const address = (params.address ?? "").toLowerCase();
  const postID = params.postId ?? "";
  const valid = isProfileAddress(address) && isPostID(postID);
  const post = usePostQuery(address, postID, valid);
  const { data: me } = useMyInfoQuery();
  if (!valid) return <NotFound />;
  if (post.isPending) return <Skeleton active />;
  if (post.isError) {
    return isProblem(post.error, HubPostNotFoundError.type) ? (
      <NotFound />
    ) : (
      <APIErrorAlert error={post.error} />
    );
  }
  // An alias in the URL redirects to the permanent handle (PST-UI-001).
  if (post.data.owner.handle !== address) {
    return (
      <Navigate
        replace
        to={`/u/${post.data.owner.handle}/posts/${post.data.post_id}`}
      />
    );
  }
  const isOwner = me?.handle === post.data.owner.handle;
  return (
    <Flex vertical gap="middle">
      <title>
        {t("posts.documentTitle", { name: post.data.owner.display_name })}
      </title>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={`/u/${post.data.owner.handle}`}>
                {post.data.owner.display_name}
              </Link>
            ),
          },
          { title: t("posts.title") },
        ]}
      />
      <PostCard post={post.data} link={false} />
      {isOwner ? <OwnerControls post={post.data} /> : null}
    </Flex>
  );
}
