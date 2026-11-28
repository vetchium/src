import { Button, Flex, Form, Input, Select, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isBody,
  MaxBodyLength,
  type QuotePolicy,
  type ReplyPolicy,
} from "typespec/hub/posts/posts";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useCreatePostMutation } from "./queries";

export function PolicySelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: ReplyPolicy | QuotePolicy;
  onChange: (value: ReplyPolicy | QuotePolicy) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Form.Item label={label} style={{ marginBottom: 0 }}>
      <Select
        value={value}
        disabled={disabled}
        onChange={onChange}
        style={{ minWidth: 160 }}
        options={[
          { value: "everyone", label: t("posts.policy.everyone") },
          { value: "nobody", label: t("posts.policy.nobody") },
        ]}
      />
    </Form.Item>
  );
}

/** Creates a top-level post (PST-POS-001, PST-POS-004). */
export function PostComposer() {
  const { t } = useTranslation();
  const create = useCreatePostMutation();
  const [body, setBody] = useState("");
  const [replyPolicy, setReplyPolicy] = useState<ReplyPolicy>("everyone");
  const [quotePolicy, setQuotePolicy] = useState<QuotePolicy>("everyone");
  const size = [...body].length;
  const valid = isBody(body.trim());
  const submit = () =>
    create.mutate(
      { body, reply_policy: replyPolicy, quote_policy: quotePolicy },
      { onSuccess: () => setBody("") },
    );
  return (
    <Form layout="vertical" onFinish={submit}>
      <Flex vertical gap="small">
        <Form.Item
          label={t("posts.composer.label")}
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            value={body}
            rows={4}
            onChange={(event) => setBody(event.target.value)}
            aria-describedby="post-counter"
          />
        </Form.Item>
        <Typography.Text
          id="post-counter"
          type={size > MaxBodyLength ? "danger" : "secondary"}
        >
          {t("posts.composer.counter", { count: size, max: MaxBodyLength })}
        </Typography.Text>
        <Flex gap="middle" wrap align="end">
          <PolicySelect
            label={t("posts.replyPolicy")}
            value={replyPolicy}
            onChange={(value) => setReplyPolicy(value)}
            disabled={create.isPending}
          />
          <PolicySelect
            label={t("posts.quotePolicy")}
            value={quotePolicy}
            onChange={(value) => setQuotePolicy(value)}
            disabled={create.isPending}
          />
          <Button
            type="primary"
            htmlType="submit"
            loading={create.isPending}
            disabled={!valid}
          >
            {t("posts.composer.submit")}
          </Button>
        </Flex>
        <APIErrorAlert error={create.error} />
      </Flex>
    </Form>
  );
}
