import { Form, Input, Radio } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isWebsiteURL, normalizeWebsiteURL } from "typespec/hub/profile/public";
import type {
  ApplicationDetail,
  CheckOutcome,
} from "typespec/orgs/applications/applications";
import {
  checkOutcomeValues,
  isResultNotes,
  maxResultNotes,
} from "typespec/orgs/applications/applications";
import type { CheckType } from "typespec/orgs/hiring/vocabulary";
import { ActionDialog } from "./ActionDialog";
import { useRecordCheckResultMutation } from "./queries";

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  checkType: CheckType;
  onClose: () => void;
}

/** Records what one consented check found. Vetchium keeps the outcome and a
 * link to the performer's report, never the report itself. */
export function CheckResultDialog({
  detail,
  openingNumber,
  checkType,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const record = useRecordCheckResultMutation();
  const [outcome, setOutcome] = useState<CheckOutcome>();
  const [notes, setNotes] = useState("");
  const [link, setLink] = useState("");
  const trimmed = notes.trim();
  const url = normalizeWebsiteURL(link);
  const valid =
    outcome !== undefined &&
    (trimmed === "" || isResultNotes(trimmed)) &&
    (url === "" || isWebsiteURL(url));
  const label = t(`applications.work.checkTypes.${checkType}`, {
    defaultValue: checkType,
  });

  return (
    <ActionDialog
      keyName={`check-result:${openingNumber}:${detail.application_number}:${checkType}`}
      title={t("applications.checkResult.title", { check: label })}
      okText={t("applications.checkResult.confirm")}
      doneMessage={t("applications.checkResult.done", { check: label })}
      valid={valid}
      fingerprint={JSON.stringify([outcome, trimmed, url])}
      submit={(key) =>
        record.mutateAsync({
          request: {
            opening_number: openingNumber,
            application_number: detail.application_number,
            version: detail.version,
            check_type: checkType,
            outcome: outcome ?? "clear",
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
          label={t("applications.checkResult.outcome")}
          required
          extra={t("applications.work.resultsNotDecided")}
        >
          <Radio.Group
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as CheckOutcome)}
            options={checkOutcomeValues.map((value) => ({
              value,
              label: t(`applications.work.checkOutcomes.${value}`),
            }))}
          />
        </Form.Item>
        <Form.Item label={t("applications.assessment.notes")}>
          <Input.TextArea
            value={notes}
            rows={3}
            maxLength={maxResultNotes}
            showCount
            onChange={(event) => setNotes(event.target.value)}
            aria-label={t("applications.assessment.notes")}
            placeholder={t("applications.optional")}
          />
        </Form.Item>
        <Form.Item
          label={t("applications.checkResult.link")}
          extra={t("applications.checkResult.linkHelp")}
          validateStatus={
            url !== "" && !isWebsiteURL(url) ? "error" : undefined
          }
        >
          <Input
            value={link}
            inputMode="url"
            onChange={(event) => setLink(event.target.value)}
            aria-label={t("applications.checkResult.link")}
            placeholder={t("applications.optional")}
          />
        </Form.Item>
      </Form>
    </ActionDialog>
  );
}
