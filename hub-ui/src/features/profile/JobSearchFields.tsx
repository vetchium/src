import { Form, Input, Switch } from "antd";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { maxIdealJobCodePoints } from "typespec/hub/types";
import {
  normalizeSetIdealJobRequest,
  validateSetIdealJobRequest,
} from "typespec/hub/users/profile";

const codePoints = (text: string) => Array.from(text).length;

/** Whether `idealJob` would pass set-ideal-job validation once trimmed. */
export function isIdealJobValid(idealJob: string): boolean {
  return (
    validateSetIdealJobRequest(
      normalizeSetIdealJobRequest({ ideal_job: idealJob }),
    ).length === 0
  );
}

/** The ideal-job textarea and looking-for-a-job switch (PROF-JOB-006,
 * PROF-JOB-007), shared by the Home prompt and Preferences. */
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
  const idealJobID = useId();
  const lookingID = useId();
  const tooLong = !isIdealJobValid(idealJob);
  return (
    <>
      <Form.Item
        label={t("preferences.idealJob")}
        htmlFor={idealJobID}
        validateStatus={tooLong ? "error" : undefined}
        help={tooLong ? t("preferences.idealJobTooLong") : undefined}
        extra={t("preferences.idealJobHelp")}
      >
        {/* The counter sits below the textarea; keep it clear of the help. */}
        <div style={{ paddingBottom: 20 }}>
          <Input.TextArea
            id={idealJobID}
            value={idealJob}
            onChange={(event) => onIdealJobChange(event.target.value)}
            autoSize={{ minRows: 3, maxRows: 10 }}
            count={{
              show: true,
              max: maxIdealJobCodePoints,
              strategy: codePoints,
            }}
          />
        </div>
      </Form.Item>
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
