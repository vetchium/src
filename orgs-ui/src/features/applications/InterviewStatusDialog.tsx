import { Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  ApplicationDetail,
  Interview,
  InterviewOutcome,
} from "typespec/orgs/applications/applications";
import { ActionDialog } from "./ActionDialog";
import {
  useCancelInterviewMutation,
  useRecordInterviewOutcomeMutation,
} from "./queries";

export type InterviewStatusAction = "cancel" | InterviewOutcome;

interface Props {
  action: InterviewStatusAction;
  detail: ApplicationDetail;
  openingNumber: number;
  interview: Interview;
  onClose: () => void;
}

/** Cancels an upcoming interview or records how a started one went. */
export function InterviewStatusDialog({
  action,
  detail,
  openingNumber,
  interview,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const cancel = useCancelInterviewMutation();
  const outcome = useRecordInterviewOutcomeMutation();

  return (
    <ActionDialog
      keyName={`interview-${action}:${openingNumber}:${detail.application_number}:${interview.interview_number}`}
      title={t(`applications.interview.${action}.title`, {
        number: interview.interview_number,
      })}
      okText={t(`applications.interview.${action}.confirm`)}
      doneMessage={t(`applications.interview.${action}.done`)}
      danger={action === "cancel"}
      fingerprint={action}
      submit={(key) => {
        const request = {
          opening_number: openingNumber,
          application_number: detail.application_number,
          version: detail.version,
          interview_number: interview.interview_number,
        };
        return action === "cancel"
          ? cancel.mutateAsync({ request, key })
          : outcome.mutateAsync({
              request: { ...request, outcome: action },
              key,
            });
      }}
      onClose={onClose}
    >
      <Typography.Paragraph>
        {t(`applications.interview.${action}.body`)}
      </Typography.Paragraph>
    </ActionDialog>
  );
}
