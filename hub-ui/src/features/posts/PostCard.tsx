import { Card, Flex, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { Post } from "typespec/hub/posts/posts";
import { ProfileAvatar } from "../../components/common/ProfileAvatar";
import { PostEmbed } from "./PostEmbed";
import { QuoteButton } from "./QuoteComposer";
import { relativeTime } from "./time";

export function postPath(post: Post): string {
  return `/u/${post.owner.handle}/posts/${post.post_id}`;
}

/** One post: owner, time, plain-text words, and the counts (PST-POS-009). */
export function PostCard({
  post,
  link = true,
  showEmbed = true,
  children,
}: {
  post: Post;
  /** The quotes page already names the target, so it passes false. */
  showEmbed?: boolean;
  /** Links the time to the post page. The post page itself passes false. */
  link?: boolean;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const when = relativeTime(i18n.language, post.created_at);
  return (
    <Card size="small">
      <Flex gap="middle" align="start">
        <ProfileAvatar
          size={40}
          displayName={post.owner.display_name}
          src={post.owner.picture_url}
          alt={t("posts.pictureAlt", { name: post.owner.display_name })}
        />
        <Flex vertical gap="small" style={{ flex: 1, minWidth: 0 }}>
          <Space size="small" wrap separator={<span>·</span>}>
            <Link to={`/u/${post.owner.handle}`}>
              <Typography.Text strong>
                {post.owner.display_name}
              </Typography.Text>{" "}
              <Typography.Text type="secondary">
                @{post.owner.handle}
              </Typography.Text>
            </Link>
            {link ? (
              <Link to={postPath(post)}>
                <time dateTime={post.created_at}>{when}</time>
              </Link>
            ) : (
              <time dateTime={post.created_at}>{when}</time>
            )}
            {post.edited ? <Tag>{t("posts.edited")}</Tag> : null}
            {post.locked ? <Tag>{t("posts.locked")}</Tag> : null}
          </Space>
          <Typography.Paragraph
            style={{
              marginBottom: 0,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {post.body}
          </Typography.Paragraph>
          {showEmbed && post.kind === "quote" ? (
            <PostEmbed embed={post.embed} />
          ) : null}
          <Space size="middle" wrap>
            {link ? (
              <Link to={postPath(post)}>
                {t("posts.replyCount", { count: post.reply_count })}
              </Link>
            ) : (
              <Typography.Text type="secondary">
                {t("posts.replyCount", { count: post.reply_count })}
              </Typography.Text>
            )}
            <Link to={`${postPath(post)}/quotes`}>
              {t("posts.quoteCount", { count: post.quote_count })}
            </Link>
            {post.quote_policy !== "nobody" ? (
              <QuoteButton
                title={t("posts.quote.title")}
                target={{
                  type: "timeline_post",
                  owner: post.owner.handle,
                  post_id: post.post_id,
                }}
                preview={<PostEmbed embed={{ state: "post", post }} />}
              />
            ) : null}
          </Space>
          {children}
        </Flex>
      </Flex>
    </Card>
  );
}
