import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  Button,
  Flex,
  Input,
  Popover,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OpeningContent } from "typespec/common/openings";
import {
  type DraftOpeningResponse,
  MaxDraftInstructionLength,
} from "typespec/orgs/ai/ai";
import { OpeningDraft } from "typespec/orgs/ai/types";
import {
  AICreditsInsufficientErrorType,
  AIModelFailedError,
  AIModelNotAllowedError,
  AINotEnabledError,
  AIOperationOffError,
  AIOutputUnusableError,
  AIRequestInProgressError,
} from "typespec/problem/orgs/ai";
import { PlanRequiredErrorType } from "typespec/problem/orgs/billing";
import { APIError } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { aiQueryKey, isAIUnavailable, useAIOptionsQuery } from "./queries";
import { VetchiumAIIcon } from "./VetchiumAIIcon";

const problemKeys: Readonly<Record<string, string>> = {
  [AINotEnabledError.type]: "ai.draft.errors.notEnabled",
  [AIOperationOffError.type]: "ai.draft.errors.operationOff",
  [PlanRequiredErrorType]: "ai.draft.errors.planRequired",
  [AICreditsInsufficientErrorType]: "ai.draft.errors.noCredits",
  [AIModelNotAllowedError.type]: "ai.draft.errors.modelNotAllowed",
  [AIRequestInProgressError.type]: "ai.draft.errors.inProgress",
  [AIModelFailedError.type]: "ai.draft.errors.modelFailed",
  [AIOutputUnusableError.type]: "ai.draft.errors.unusable",
};

/**
 * Opens a prompt that drafts Opening content with AI. The draft only fills
 * the editor; the user reviews it and saves through the normal save.
 */
export function DraftWithAIButton({
  currentContent,
  onDrafted,
  disabled = false,
}: {
  currentContent: () => OpeningContent;
  onDrafted: (draft: DraftOpeningResponse) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [model, setModel] = useState<string>();
  const key = useIdempotencyKey();
  const sent = useRef<string | null>(null);
  const options = useAIOptionsQuery(OpeningDraft);
  const number = new Intl.NumberFormat(i18n.language);
  const draft = useMutation({
    mutationFn: (modelOID: string | undefined) => {
      const request = {
        instruction: instruction.trim(),
        current_content: currentContent(),
        ...(modelOID === undefined ? {} : { model_oid: modelOID }),
      };
      // The same key may retry only the identical request. After a network
      // error the server may already hold this key, so a changed prompt,
      // form, or model needs a new one.
      const body = JSON.stringify(request);
      if (sent.current !== body) key.rotate();
      sent.current = body;
      return orgsAPI.draftOpeningWithAI(request, key.current());
    },
    onSuccess: (response) => {
      sent.current = null;
      void queryClient.invalidateQueries({ queryKey: aiQueryKey });
      setOpen(false);
      setInstruction("");
      onDrafted(response);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: aiQueryKey });
    },
  });

  if (options.isError && isAIUnavailable(options.error)) return null;
  const data = options.data;
  const chosen =
    data?.models.find((entry) => entry.model_oid === model) ??
    data?.models.find((entry) => entry.model_oid === data.default_model);
  const ready = data?.availability === "ready" && chosen !== undefined;
  const unavailableReason =
    data === undefined
      ? undefined
      : data.availability === "not_enabled"
        ? t("ai.draft.unavailable.notEnabled")
        : data.availability === "operation_off"
          ? t("ai.draft.unavailable.operationOff")
          : data.availability === "plan_required"
            ? t("ai.draft.unavailable.planRequired")
            : data.availability === "no_credits"
              ? t("ai.draft.unavailable.noCredits")
              : chosen === undefined
                ? t("ai.draft.unavailable.noModel")
                : undefined;
  const errorMessage = (() => {
    if (draft.error === null) return undefined;
    const type =
      draft.error instanceof APIError ? draft.error.problem?.type : undefined;
    const translation = type === undefined ? undefined : problemKeys[type];
    return translation === undefined
      ? problemMessage(t, draft.error)
      : t(translation);
  })();
  const trimmed = instruction.trim();

  const content = (
    <Flex vertical gap="small" className="ai-draft-panel">
      <Typography.Text type="secondary">{t("ai.draft.help")}</Typography.Text>
      {options.isPending ? (
        <Typography.Text type="secondary">
          {t("common.loading")}
        </Typography.Text>
      ) : options.isError ? (
        <Alert type="error" showIcon title={problemMessage(t, options.error)} />
      ) : unavailableReason !== undefined ? (
        <Alert type="info" showIcon title={unavailableReason} />
      ) : null}
      <Input.TextArea
        aria-label={t("ai.draft.instructionLabel")}
        placeholder={t("ai.draft.placeholder")}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        autoSize={{ minRows: 4, maxRows: 10 }}
        maxLength={MaxDraftInstructionLength}
        showCount
        disabled={!ready || draft.isPending}
      />
      {data !== undefined && data.models.length > 1 ? (
        <Select
          aria-label={t("ai.draft.modelLabel")}
          value={chosen?.model_oid}
          onChange={setModel}
          disabled={!ready || draft.isPending}
          options={data.models.map((entry) => ({
            value: entry.model_oid,
            label: t("ai.draft.modelOption", {
              name: entry.display_name,
              vendor: entry.vendor,
            }),
          }))}
        />
      ) : null}
      {ready && chosen !== undefined ? (
        <Typography.Text type="secondary" data-testid="ai-draft-balance">
          {t("ai.draft.available", {
            available: number.format(data?.balance_available ?? 0),
          })}
        </Typography.Text>
      ) : null}
      {errorMessage !== undefined ? (
        <Alert type="error" showIcon title={errorMessage} />
      ) : null}
      <Space>
        <Button
          type="primary"
          icon={<VetchiumAIIcon />}
          loading={draft.isPending}
          disabled={!ready || trimmed === ""}
          onClick={() => draft.mutate(chosen?.model_oid)}
        >
          {t("ai.draft.generate")}
        </Button>
        <Button onClick={() => setOpen(false)} disabled={draft.isPending}>
          {t("common.cancel")}
        </Button>
      </Space>
      <Typography.Text type="secondary">{t("ai.draft.review")}</Typography.Text>
    </Flex>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!draft.isPending) setOpen(next);
      }}
      trigger="click"
      placement="bottomRight"
      title={t("ai.draft.title")}
      content={content}
    >
      <Tooltip title={t("ai.draft.title")}>
        <Button
          icon={<VetchiumAIIcon />}
          aria-label={t("ai.draft.title")}
          disabled={disabled}
          data-testid="draft-with-ai"
        >
          {t("ai.draft.button")}
        </Button>
      </Tooltip>
    </Popover>
  );
}
