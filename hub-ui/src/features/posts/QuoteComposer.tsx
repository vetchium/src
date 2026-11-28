import { App, Button, Flex, Form, Input, Modal, Typography } from "antd";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  isBody,
  MaxBodyLength,
  type QuotePolicy,
  type ReplyPolicy,
} from "typespec/hub/posts/posts";
import type { QuoteTarget } from "typespec/hub/posts/quotes";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { PolicySelect } from "./PostComposer";
import { useCreateQuoteMutation } from "./queries";

function QuoteForm({
  target,
  preview,
  onDone,
}: {
  target: QuoteTarget;
  preview: ReactNode;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const create = useCreateQuoteMutation();
  const [body, setBody] = useState("");
  const [replyPolicy, setReplyPolicy] = useState<ReplyPolicy>("everyone");
  const [quotePolicy, setQuotePolicy] = useState<QuotePolicy>("everyone");
  const size = [...body].length;
  const submit = () =>
    create.mutate(
      {
        target,
        body,
        reply_policy: replyPolicy,
        quote_policy: quotePolicy,
      },
      {
        onSuccess: (post) => {
          void message.success(t("posts.quote.done"));
          onDone();
          void navigate(`/u/${post.owner.handle}/posts/${post.post_id}`);
        },
      },
    );
  return (
    <Form layout="vertical" onFinish={submit}>
      <Flex vertical gap="small">
        {preview}
        <Form.Item
          label={t("posts.quote.label")}
          htmlFor="quote-body"
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            id="quote-body"
            value={body}
            rows={4}
            onChange={(event) => setBody(event.target.value)}
            aria-describedby="quote-counter"
          />
        </Form.Item>
        <Typography.Text
          id="quote-counter"
          type={size > MaxBodyLength ? "danger" : "secondary"}
        >
          {t("posts.composer.counter", { count: size, max: MaxBodyLength })}
        </Typography.Text>
        <Flex gap="middle" wrap align="end">
          <PolicySelect
            id="quote-reply-policy"
            label={t("posts.replyPolicy")}
            value={replyPolicy}
            onChange={(value) => setReplyPolicy(value)}
            disabled={create.isPending}
          />
          <PolicySelect
            id="quote-quote-policy"
            label={t("posts.quotePolicy")}
            value={quotePolicy}
            onChange={(value) => setQuotePolicy(value)}
            disabled={create.isPending}
          />
        </Flex>
        <APIErrorAlert error={create.error} />
        <Flex gap="small" justify="end">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button
            type="primary"
            htmlType="submit"
            loading={create.isPending}
            disabled={!isBody(body.trim())}
          >
            {t("posts.quote.submit")}
          </Button>
        </Flex>
      </Flex>
    </Form>
  );
}

/**
 * The Quote button and its dialog. Every tier may quote (PST-QTE-001). The
 * form remounts on each open, so a closed dialog keeps no draft.
 */
export function QuoteButton({
  target,
  preview,
  title,
}: {
  target: QuoteTarget;
  /** What the quote points at, shown above the words. */
  preview: ReactNode;
  title: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        {t("posts.quote.button")}
      </Button>
      <Modal
        title={title}
        open={open}
        footer={null}
        destroyOnHidden
        onCancel={() => setOpen(false)}
      >
        <QuoteForm
          target={target}
          preview={preview}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
