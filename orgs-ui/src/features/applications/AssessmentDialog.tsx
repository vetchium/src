import { Form, Input, InputNumber, Radio } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isWebsiteURL, normalizeWebsiteURL } from "typespec/hub/profile/public";
import type {
  ApplicationDetail,
  AssessmentOutcome,
} from "typespec/orgs/applications/applications";
import {
  assessmentOutcomeValues,
  isResultNotes,
  maxAssessmentScore,
  maxResultNotes,
} from "typespec/orgs/applications/applications";
import { ActionDialog } from "./ActionDialog";
import { useRecordAssessmentMutation } from "./queries";

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  onClose: () => void;
}

/** Records the result of an assessment stage, which completes the stage. */
export function AssessmentDialog({ detail, openingNumber, onClose }: Props) {
  const { t } = useTranslation();
  const record = useRecordAssessmentMutation();
  const [outcome, setOutcome] = useState<AssessmentOutcome>();
  const [score, setScore] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [link, setLink] = useState("");
  const trimmed = notes.trim();
  const url = normalizeWebsiteURL(link);
  const valid =
    outcome !== undefined &&
    (trimmed === "" || isResultNotes(trimmed)) &&
    (url === "" || isWebsiteURL(url));

  return (
    <ActionDialog
      keyName={`assessment:${openingNumber}:${detail.application_number}`}
      title={t("applications.assessment.title", {
        stage: detail.current_stage?.name ?? "",
      })}
      okText={t("applications.assessment.confirm")}
      doneMessage={t("applications.assessment.done")}
      valid={valid}
      fingerprint={JSON.stringify([outcome, score, trimmed, url])}
      submit={(key) =>
        record.mutateAsync({
          request: {
            opening_number: openingNumber,
            application_number: detail.application_number,
            version: detail.version,
            outcome: outcome ?? "inconclusive",
            ...(score !== null && { score }),
            ...(trimmed !== "" && { notes: trimmed }),
            ...(url !== "" && { report_url: url }),
          },
          key,
        })
      }
      onClose={onClose}
    >
      <Form layout="vertical" component="div">
        <Form.Item
          label={t("applications.assessment.outcome")}
          required
          extra={t("applications.assessment.help")}
        >
          <Radio.Group
            value={outcome}
            onChange={(event) =>
              setOutcome(event.target.value as AssessmentOutcome)
            }
            options={assessmentOutcomeValues.map((value) => ({
              value,
              label: t(`applications.work.outcomes.${value}`),
            }))}
          />
        </Form.Item>
        <Form.Item label={t("applications.assessment.score")}>
          <InputNumber
            min={0}
            max={maxAssessmentScore}
            precision={0}
            value={score}
            onChange={setScore}
            aria-label={t("applications.assessment.score")}
            placeholder={t("applications.optional")}
          />
        </Form.Item>
        <Form.Item label={t("applications.assessment.notes")}>
          <Input.TextArea
            value={notes}
            rows={4}
            maxLength={maxResultNotes}
            showCount
            onChange={(event) => setNotes(event.target.value)}
            aria-label={t("applications.assessment.notes")}
            placeholder={t("applications.optional")}
          />
        </Form.Item>
        <Form.Item
          label={t("applications.assessment.link")}
          extra={t("applications.assessment.linkHelp")}
          validateStatus={
            url !== "" && !isWebsiteURL(url) ? "error" : undefined
          }
        >
          <Input
            value={link}
            inputMode="url"
            onChange={(event) => setLink(event.target.value)}
            aria-label={t("applications.assessment.link")}
            placeholder={t("applications.optional")}
          />
        </Form.Item>
      </Form>
    </ActionDialog>
  );
}
