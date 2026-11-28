import { Flex, Skeleton, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { PostsTab } from "../features/posts/PostsTab";
import { useMyInfoQuery } from "../features/profile/queries";

/** The signed-in user's own posts with the composer (PST-UI-008). */
export function TimelinePage() {
  const { t } = useTranslation();
  const me = useMyInfoQuery();
  return (
    <Flex vertical gap="large">
      <title>{t("timeline.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("timeline.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("timeline.description")}
        </Typography.Text>
      </div>
      {me.isError ? (
        <APIErrorAlert error={me.error} />
      ) : me.data === undefined ? (
        <Skeleton active />
      ) : (
        <>
          <Link to={`/u/${me.data.handle}?tab=replies`}>
            {t("timeline.replies")}
          </Link>
          <PostsTab handle={me.data.handle} isOwner />
        </>
      )}
    </Flex>
  );
}
