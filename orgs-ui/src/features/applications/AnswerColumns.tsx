import { Select, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationQuestion,
  ApplicationQuestionID,
} from "typespec/common/openings";
import {
  isAnswerColumnQuestion,
  maxAnswerColumns,
} from "typespec/orgs/applications/answers";
import type { ApplicationSummary } from "typespec/orgs/applications/applications";
import { useMyInfoQuery } from "../account/queries";
import { answerText } from "./AnswersCard";

function storageKey(viewer: string, openingNumber: number): string {
  return `vetchium.orgs.answer-columns.${viewer}.${openingNumber}`;
}

function remembered(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(
      globalThis.localStorage?.getItem(key) ?? "[]",
    );
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function remember(key: string, ids: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(ids));
  } catch {
    // The choice still holds for this page.
  }
}

/**
 * The answer columns this viewer picked for an Opening's lists, kept in the
 * browser (HP-QST-009). Ids of questions that are no longer live, or no longer
 * short-answer, drop out.
 */
export function useAnswerColumns(
  openingNumber: number,
  questions: readonly ApplicationQuestion[],
) {
  const viewer = useMyInfoQuery().data?.email_address ?? "";
  const key = storageKey(viewer, openingNumber);
  const [chosen, setChosen] = useState<{ key: string; ids: string[] }>();
  const eligible = questions.filter(
    (question) =>
      question.id !== undefined && isAnswerColumnQuestion(question.type),
  );
  const ids = (chosen?.key === key ? chosen.ids : remembered(key))
    .filter((id) => eligible.some((question) => question.id === id))
    .slice(0, maxAnswerColumns);
  const choose = (next: string[]) => {
    // Before my-info arrives the viewer is unknown; the choice then holds
    // only for this page.
    if (viewer) remember(key, next);
    setChosen({ key, ids: next });
  };
  return { eligible, ids, choose };
}

/** A toolbar control; renders nothing when no live question can be a column. */
export function AnswerColumnPicker({
  eligible,
  ids,
  onChange,
}: {
  eligible: readonly ApplicationQuestion[];
  ids: readonly ApplicationQuestionID[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  if (eligible.length === 0) return null;
  const label = t("applications.answerColumns.label", {
    limit: maxAnswerColumns,
  });
  return (
    <Select
      mode="multiple"
      className="toolbar-select"
      style={{ minWidth: 260 }}
      aria-label={label}
      placeholder={label}
      maxCount={maxAnswerColumns}
      maxTagTextLength={24}
      allowClear
      value={[...ids]}
      options={eligible.map((question) => ({
        value: question.id,
        label: question.text,
      }))}
      onChange={onChange}
    />
  );
}

/** One list column per picked question, showing each row's answer. */
export function useAnswerTableColumns(
  eligible: readonly ApplicationQuestion[],
  ids: readonly ApplicationQuestionID[],
): ColumnsType<ApplicationSummary> {
  const { t, i18n } = useTranslation();
  return ids.flatMap((id) => {
    const question = eligible.find((entry) => entry.id === id);
    if (!question) return [];
    return [
      {
        title: question.text,
        key: `answer-${id}`,
        ellipsis: true,
        width: 200,
        render: (_: unknown, application: ApplicationSummary) => {
          const answer = application.answers?.find(
            (entry) => entry.question_id === id,
          );
          return answer === undefined ? (
            <Typography.Text type="secondary">
              {t("applications.answers.noAnswer")}
            </Typography.Text>
          ) : (
            answerText(t, i18n.language, answer.value)
          );
        },
      },
    ];
  });
}
