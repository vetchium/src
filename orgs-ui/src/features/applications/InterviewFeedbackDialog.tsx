import { Alert, Form, Input, Radio, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationDetail,
  Interview,
  InterviewRecommendation,
} from "typespec/orgs/applications/applications";
import {
  interviewRecommendationValues,
  isInterviewFeedbackNotes,
  maxFeedbackNotes,
} from "typespec/orgs/applications/applications";
import { ActionDialog } from "./ActionDialog";
import {
  CriteriaInputs,
  type CriteriaValues,
  criteriaAnswers,
  criteriaComplete,
} from "./CriteriaInputs";
import { applicationProblem } from "./problems";
import { useSubmitInterviewFeedbackMutation } from "./queries";

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  interview: Interview;
  onClose: () => void;
}

/** Feedback is final: one submission per interviewer, and only then can the
 * interviewer read what the others wrote. */
export function InterviewFeedbackDialog({
  detail,
  openingNumber,
  interview,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const submitFeedback = useSubmitInterviewFeedbackMutation();
  const [recommendation, setRecommendation] =
    useState<InterviewRecommendation>();
  const [notes, setNotes] = useState("");
  const [criteria, setCriteria] = useState<CriteriaValues>({});
  const [invalid, setInvalid] = useState<string[]>([]);
  const form = interview.stage.feedback_form ?? [];
  const answers = criteriaAnswers(form, criteria);
  const trimmed = notes.trim();
  const valid =
    recommendation !== undefined &&
    isInterviewFeedbackNotes(trimmed) &&
    criteriaComplete(form, criteria);

  return (
    <ActionDialog
      keyName={`interview-feedback:${openingNumber}:${detail.application_number}:${interview.interview_number}`}
      title={t("applications.feedback.title", {
        number: interview.interview_number,
      })}
      okText={t("applications.feedback.confirm")}
      doneMessage={t("applications.feedback.done")}
      valid={valid}
      fingerprint={JSON.stringify([recommendation, trimmed, answers])}
      onRefused={(cause) => {
        const problem = applicationProblem(cause);
        if (problem.kind === "answers-invalid")
          setInvalid(problem.criterionIDs);
      }}
      submit={(key) =>
        submitFeedback.mutateAsync({
          request: {
            opening_number: openingNumber,
            application_number: detail.application_number,
            version: detail.version,
            interview_number: interview.interview_number,
            recommendation: recommendation ?? "yes",
            notes: trimmed,
            ...(answers.length > 0 && { criteria_answers: answers }),
          },
          key,
        })
      }
      onClose={onClose}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={t("applications.feedback.rule")}
      />
      <Form layout="vertical" component="div">
        <Form.Item label={t("applications.feedback.recommendation")} required>
          <Radio.Group
            value={recommendation}
            onChange={(event) =>
              setRecommendation(event.target.value as InterviewRecommendation)
            }
            options={interviewRecommendationValues.map((value) => ({
              value,
              label: t(`applications.work.recommendations.${value}`),
            }))}
          />
        </Form.Item>
        <CriteriaInputs
          form={form}
          values={criteria}
          invalid={invalid}
          onChange={(next) => {
            setCriteria(next);
            setInvalid([]);
          }}
        />
        <Form.Item
          label={t("applications.feedback.notes")}
          required
          extra={t("applications.feedback.notesHelp")}
        >
          <Input.TextArea
            value={notes}
            rows={6}
            maxLength={maxFeedbackNotes}
            showCount
            onChange={(event) => setNotes(event.target.value)}
            aria-label={t("applications.feedback.notes")}
          />
        </Form.Item>
        <Typography.Text type="secondary">
          {t("applications.feedback.final")}
        </Typography.Text>
      </Form>
    </ActionDialog>
  );
}
