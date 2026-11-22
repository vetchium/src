import { Form, Input, Switch } from "antd";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { maxIdealJobCodePoints } from "typespec/hub/types";
import {
  normalizeSetIdealJobRequest,
  validateSetIdealJobRequest,
} from "typespec/hub/users/profile";
import { FieldLabel } from "../../components/common/FieldLabel";

const codePoints = (text: string) => Array.from(text).length;

/** Whether `idealJob` would pass set-ideal-job validation once trimmed. */
export function isIdealJobValid(idealJob: string): boolean {
  return (
    validateSetIdealJobRequest(
      normalizeSetIdealJobRequest({ ideal_job: idealJob }),
    ).length === 0
  );
}

/** The ideal-job textarea, shared by Home's setup and Preferences. */
export function IdealJobField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const shownError = isIdealJobValid(value)
    ? error
    : t("preferences.idealJobTooLong");
  return (
    <>
      <FieldLabel
        htmlFor={id}
        label={t("preferences.idealJob")}
        help={t("preferences.idealJobHelp")}
      />
      <Form.Item
        validateStatus={shownError === undefined ? undefined : "error"}
        help={shownError}
      >
        {/* The counter sits below the textarea; keep it clear of the error. */}
        <div style={{ paddingBottom: 20 }}>
          <Input.TextArea
            id={id}
            aria-invalid={shownError !== undefined}
            placeholder={t("preferences.idealJobPlaceholder")}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoSize={{ minRows: 3, maxRows: 10 }}
            count={{
              show: true,
              max: maxIdealJobCodePoints,
              strategy: codePoints,
            }}
          />
        </div>
      </Form.Item>
    </>
  );
}

/** The ideal-job textarea and looking-for-a-job switch of Preferences
 * (PROF-JOB-007). */
export function JobSearchFields({
  idealJob,
  onIdealJobChange,
  lookingForJob,
  onLookingForJobChange,
  lookingForJobPending = false,
  idealJobActions,
}: {
  idealJob: string;
  onIdealJobChange: (value: string) => void;
  lookingForJob: boolean;
  onLookingForJobChange: (value: boolean) => void;
  lookingForJobPending?: boolean;
  /** Shown under the textarea, for a screen that saves it on its own. */
  idealJobActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const lookingID = useId();
  return (
    <>
      <IdealJobField value={idealJob} onChange={onIdealJobChange} />
      {idealJobActions}
      <Form.Item
        label={t("preferences.lookingForJob")}
        htmlFor={lookingID}
        extra={t("preferences.lookingForJobHelp")}
      >
        <Switch
          id={lookingID}
          checked={lookingForJob}
          loading={lookingForJobPending}
          onChange={(checked) => {
            if (!lookingForJobPending) onLookingForJobChange(checked);
          }}
        />
      </Form.Item>
    </>
  );
}
