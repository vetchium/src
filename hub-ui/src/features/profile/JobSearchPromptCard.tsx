import { CompassOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Form, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeSetIdealJobRequest } from "typespec/hub/users/profile";
import { hubAPI } from "../../api/hub";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { isIdealJobValid, JobSearchFields } from "./JobSearchFields";
import { myInfoQueryKey } from "./queries";

/** Asks a Hub user without an ideal job for one until they save or dismiss
 * it (PROF-JOB-006); the server keeps the dismissal for every device. */
export function JobSearchPromptCard({
  lookingForJob: savedLookingForJob,
}: {
  lookingForJob: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [idealJob, setIdealJob] = useState("");
  const [lookingForJob, setLookingForJob] = useState(savedLookingForJob);
  const save = useMutation({
    mutationFn: async () => {
      await hubAPI.setIdealJob(
        normalizeSetIdealJobRequest({ ideal_job: idealJob }),
      );
      await hubAPI.setLookingForJob({ looking_for_job: lookingForJob });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("jobSearchPrompt.saved"));
    },
  });
  const dismiss = useMutation({
    mutationFn: () => hubAPI.dismissJobSearchPrompt({}),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
  });
  const pending = save.isPending || dismiss.isPending;
  const canSave = idealJob.trim() !== "" && isIdealJobValid(idealJob);

  return (
    <Card
      title={
        <Space>
          <CompassOutlined />
          {t("jobSearchPrompt.title")}
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        {t("jobSearchPrompt.description")}
      </Typography.Paragraph>
      <Form layout="vertical" className="settings-form">
        <JobSearchFields
          idealJob={idealJob}
          onIdealJobChange={setIdealJob}
          lookingForJob={lookingForJob}
          onLookingForJobChange={setLookingForJob}
        />
      </Form>
      <Space wrap>
        <Button
          type="primary"
          disabled={!canSave || dismiss.isPending}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t("jobSearchPrompt.save")}
        </Button>
        <Button
          disabled={pending}
          loading={dismiss.isPending}
          onClick={() => dismiss.mutate()}
        >
          {t("jobSearchPrompt.notNow")}
        </Button>
      </Space>
      {!canSave && idealJob.trim() === "" ? (
        <Typography.Paragraph type="secondary">
          {t("jobSearchPrompt.saveNeedsIdealJob")}
        </Typography.Paragraph>
      ) : null}
      <APIErrorAlert error={save.error ?? dismiss.error} />
    </Card>
  );
}
