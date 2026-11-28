import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Flex,
  Skeleton,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router";
import { isPostID, type Post } from "typespec/hub/posts/posts";
import { isProfileAddress } from "typespec/hub/profile/public";
import { HubPostNotFoundError } from "typespec/problem/hub/posts";
import { isProblem } from "../api/client";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { PostCard, postPath } from "../features/posts/PostCard";
import {
  useDetachQuoteMutation,
  usePostQuery,
  useQuotesQuery,
} from "../features/posts/queries";
import { useMyInfoQuery } from "../features/profile/queries";

function DetachButton({ target, quote }: { target: Post; quote: Post }) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const detach = useDetachQuoteMutation();
  return (
    <Flex vertical gap="small">
      <Button
        danger
        size="small"
        loading={detach.isPending}
        onClick={() =>
          modal.confirm({
            title: t("posts.quotes.detachTitle"),
            content: t("posts.quotes.detachContent"),
            okText: t("posts.quotes.detach"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            onOk: () =>
              detach
                .mutateAsync({
                  post_id: target.post_id,
                  quoter: quote.owner.handle,
                  quote_post_id: quote.post_id,
                })
                .then(() => void message.success(t("posts.quotes.detached"))),
          })
        }
      >
        {t("posts.quotes.detach")}
      </Button>
      <APIErrorAlert error={detach.error} />
    </Flex>
  );
}

function QuotesList({ target, isOwner }: { target: Post; isOwner: boolean }) {
  const { t } = useTranslation();
  const quotes = useQuotesQuery(target.owner.handle, target.post_id, true);
  const list = quotes.data?.pages.flatMap((page) => page.posts) ?? [];
  const partial = quotes.data?.pages.some((page) => page.partial) === true;
  return (
    <Flex vertical gap="middle">
      {quotes.isError ? <APIErrorAlert error={quotes.error} /> : null}
      {quotes.isPending ? <Skeleton active /> : null}
      {partial ? (
        <Alert type="warning" showIcon title={t("posts.quotes.partial")} />
      ) : null}
      {quotes.isSuccess && list.length === 0 ? (
        <Typography.Text type="secondary">
          {t("posts.quotes.empty")}
        </Typography.Text>
      ) : null}
      {list.map((quote) => (
        <PostCard key={quote.post_id} post={quote} showEmbed={false}>
          {isOwner ? <DetachButton target={target} quote={quote} /> : null}
        </PostCard>
      ))}
      {quotes.hasNextPage ? (
        <Flex justify="center">
          <Button
            loading={quotes.isFetchingNextPage}
            onClick={() => void quotes.fetchNextPage()}
          >
            {t("posts.more")}
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}

export function PostQuotesPage() {
  return (
    <>
      <NoIndex />
      <QuotesView />
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

function QuotesView() {
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
        to={`/u/${post.data.owner.handle}/posts/${post.data.post_id}/quotes`}
      />
    );
  }
  return (
    <Flex vertical gap="middle">
      <title>
        {t("posts.quotes.documentTitle", {
          name: post.data.owner.display_name,
        })}
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
          { title: <Link to={postPath(post.data)}>{t("posts.title")}</Link> },
          { title: t("posts.quotes.title") },
        ]}
      />
      <Typography.Title level={1}>{t("posts.quotes.title")}</Typography.Title>
      <PostCard post={post.data} showEmbed={false} />
      <QuotesList
        target={post.data}
        isOwner={me?.handle === post.data.owner.handle}
      />
    </Flex>
  );
}
