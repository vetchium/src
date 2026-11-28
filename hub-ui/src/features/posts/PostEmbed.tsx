import { Card, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { EmbeddedPost } from "typespec/hub/posts/posts";
import type {
  PostEmbed as PostEmbedData,
  QuoteTarget,
} from "typespec/hub/posts/quotes";
import { OpeningCard } from "../openings/OpeningCard";

function targetPath(target: QuoteTarget): string {
  return target.type === "timeline_post"
    ? `/u/${target.owner}/posts/${target.post_id}`
    : `/org/${encodeURIComponent(target.org_domain)}/openings/${target.opening_number}`;
}

/** A post inside an embed: words and owner, with no embed of its own. */
export function EmbeddedPostBody({ post }: { post: EmbeddedPost }) {
  const { t } = useTranslation();
  return (
    <Flex vertical gap="small">
      <Link to={`/u/${post.owner.handle}/posts/${post.post_id}`}>
        <Typography.Text strong>{post.owner.display_name}</Typography.Text>{" "}
        <Typography.Text type="secondary">@{post.owner.handle}</Typography.Text>
      </Link>
      <Typography.Paragraph
        style={{
          marginBottom: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {post.body}
      </Typography.Paragraph>
      {post.quote_target ? (
        // One level only: a quote inside an embed is a link (PST-QTE-010).
        <Link to={targetPath(post.quote_target)}>
          {t("posts.embed.nested")}
        </Link>
      ) : null}
    </Flex>
  );
}

/**
 * The target of a quote post as read at response time. The embed is
 * `unavailable` when the target is gone, detached, or not yet recorded by the
 * owner's tenant (PST-QTE-009, PST-QTE-011).
 */
export function PostEmbed({ embed }: { embed: PostEmbedData | undefined }) {
  const { t } = useTranslation();
  if (embed?.state === "opening") {
    return (
      <OpeningCard
        opening={embed.opening.opening}
        domain={embed.opening.org.domain}
        org={embed.opening.org}
      />
    );
  }
  return (
    <Card size="small" role="group" aria-label={t("posts.embed.label")}>
      {embed?.state === "post" ? (
        <EmbeddedPostBody post={embed.post} />
      ) : (
        <Typography.Text type="secondary">
          {t("posts.embed.unavailable")}
        </Typography.Text>
      )}
    </Card>
  );
}
