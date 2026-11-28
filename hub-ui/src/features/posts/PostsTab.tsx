import { Alert, Button, Flex, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { planIncludes, SilverTier } from "typespec/hub/subscriptions/plans";
import type { HubHandle } from "typespec/hub/types";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useMySubscriptionQuery } from "../subscriptions/queries";
import { PostCard } from "./PostCard";
import { PostComposer } from "./PostComposer";
import { usePostsQuery } from "./queries";

function OwnerComposer() {
  const { t } = useTranslation();
  const subscription = useMySubscriptionQuery();
  if (subscription.isPending) return null;
  if (subscription.isError) return <APIErrorAlert error={subscription.error} />;
  if (planIncludes(subscription.data.plan_oid, SilverTier)) {
    return <PostComposer />;
  }
  return (
    <Alert
      type="info"
      showIcon
      title={t("posts.upgrade.title")}
      description={
        <Space orientation="vertical">
          {t("posts.upgrade.description")}
          <Link to="/plan">{t("posts.upgrade.link")}</Link>
        </Space>
      }
    />
  );
}

/** The Posts tab of a profile (PST-POS-011, PST-BLK-005). */
export function PostsTab({
  handle,
  isOwner,
}: {
  handle: HubHandle;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const posts = usePostsQuery(handle, true);
  const list = posts.data?.pages.flatMap((page) => page.posts) ?? [];
  const muted = posts.data?.pages[0]?.muted === true;
  return (
    <Flex vertical gap="middle">
      {isOwner ? <OwnerComposer /> : null}
      {posts.isError ? <APIErrorAlert error={posts.error} /> : null}
      {posts.isPending ? (
        <Typography.Text>{t("posts.loading")}</Typography.Text>
      ) : null}
      {muted ? (
        <Alert type="info" showIcon title={t("posts.muted")} />
      ) : posts.isSuccess && list.length === 0 ? (
        <Typography.Text type="secondary">{t("posts.empty")}</Typography.Text>
      ) : (
        list.map((post) => <PostCard key={post.post_id} post={post} />)
      )}
      {posts.hasNextPage ? (
        <Flex justify="center">
          <Button
            loading={posts.isFetchingNextPage}
            onClick={() => void posts.fetchNextPage()}
          >
            {t("posts.more")}
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}
