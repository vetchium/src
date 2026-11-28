import { useUnsavedChangesGuard } from "@vetchium/portal-ui/unsaved-changes";
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
  Space,
  Switch,
  Tag,
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
import { planIncludes, SilverTier } from "typespec/hub/subscriptions/plans";
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
import { Thread } from "../features/posts/Thread";
import { insideEditWindow } from "../features/posts/time";
import { useMyInfoQuery } from "../features/profile/queries";
import { useMySubscriptionQuery } from "../features/subscriptions/queries";

function EditForm({ post, onDone }: { post: Post; onDone: () => void }) {
  const { t } = useTranslation();
  const edit = useEditPostMutation();
  const [body, setBody] = useState(post.body);
  const size = [...body].length;
  useUnsavedChangesGuard(body !== post.body);
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
        <Form.Item
          label={t("posts.edit.label")}
          htmlFor="post-edit-body"
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            id="post-edit-body"
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
  const dirty =
    replyPolicy !== post.reply_policy ||
    quotePolicy !== post.quote_policy ||
    locked !== post.locked;
  useUnsavedChangesGuard(dirty);
  return (
    <Card size="small" title={t("posts.policy.title")}>
      <Form
        layout="vertical"
        // The form remounts when the saved policy reaches the post, so a
        // mutate-level callback would be dropped; the promise still resolves.
        onFinish={() =>
          void save
            .mutateAsync({
              post_id: post.post_id,
              reply_policy: replyPolicy,
              quote_policy: quotePolicy,
              locked,
            })
            .then(() => void message.success(t("posts.policy.saved")))
            .catch(() => undefined)
        }
      >
        <Flex vertical gap="small">
          <Typography.Text type="secondary">
            {t("posts.policy.help")}
          </Typography.Text>
          <Flex gap="middle" wrap align="end">
            <PolicySelect
              id="policy-reply"
              label={t("posts.replyPolicy")}
              value={replyPolicy}
              onChange={(value) => setReplyPolicy(value)}
            />
            <PolicySelect
              id="policy-quote"
              label={t("posts.quotePolicy")}
              value={quotePolicy}
              onChange={(value) => setQuotePolicy(value)}
            />
            <Form.Item
              label={t("posts.policy.lock")}
              htmlFor="policy-lock"
              style={{ marginBottom: 0 }}
            >
              <Switch id="policy-lock" checked={locked} onChange={setLocked} />
            </Form.Item>
          </Flex>
          {dirty ? (
            <Space wrap>
              <Tag color="warning">{t("posts.policy.unsaved")}</Tag>
              <Button type="primary" htmlType="submit" loading={save.isPending}>
                {t("posts.policy.save")}
              </Button>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  setReplyPolicy(post.reply_policy);
                  setQuotePolicy(post.quote_policy);
                  setLocked(post.locked);
                  save.reset();
                }}
              >
                {t("posts.policy.discard")}
              </Button>
            </Space>
          ) : null}
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
  const subscription = useMySubscriptionQuery();
  // A top-level post stays frozen while its author is below Silver; a quote
  // does not (PST-POS-008).
  const entitled =
    post.kind !== "post" ||
    (subscription.isSuccess &&
      planIncludes(subscription.data.plan_oid, SilverTier));
  const canEdit = entitled && insideEditWindow(post.created_at);
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
  const replyID = params.replyId;
  const valid =
    isProfileAddress(address) &&
    isPostID(postID) &&
    (replyID === undefined || isPostID(replyID));
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
        to={`/u/${post.data.owner.handle}/posts/${post.data.post_id}${
          replyID === undefined ? "" : `/replies/${replyID}`
        }`}
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
              <Link to={`/u/${post.data.owner.handle}?tab=posts`}>
                {post.data.owner.display_name}
              </Link>
            ),
          },
          { title: t("posts.title") },
        ]}
      />
      <Typography.Title level={1}>
        {t("posts.heading", { name: post.data.owner.display_name })}
      </Typography.Title>
      <PostCard post={post.data} link={false} />
      {isOwner ? <OwnerControls post={post.data} /> : null}
      <Thread
        post={post.data}
        owner={post.data.owner.handle}
        viewer={me?.handle}
        focusID={replyID}
      />
    </Flex>
  );
}
