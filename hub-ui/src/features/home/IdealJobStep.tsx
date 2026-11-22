import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Checkbox, Flex, Form, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type MyInfoResponse,
  normalizeSetIdealJobRequest,
} from "typespec/hub/users/profile";
import { hubAPI } from "../../api/hub";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { openingSearchQueryKey } from "../openings/queries";
import { IdealJobField, isIdealJobValid } from "../profile/JobSearchFields";
import { myInfoQueryKey } from "../profile/queries";
import { StepActions, type StepProps } from "./StepActions";

/** The ideal job and looking-for-a-job; either saves without the other. */
export function IdealJobStep({
  me,
  onAdvance,
  onSkip,
  onDirtyChange,
}: StepProps & { me: MyInfoResponse }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const saved = me.ideal_job ?? "";
  const [text, setText] = useState(saved);
  const [looking, setLooking] = useState(me.looking_for_job);
  const [missing, setMissing] = useState(false);
  const textChanged = text.trim() !== saved;
  const lookingChanged = looking !== me.looking_for_job;
  const dirty = textChanged || lookingChanged;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: async () => {
      const request = normalizeSetIdealJobRequest({ ideal_job: text });
      if (textChanged) await hubAPI.setIdealJob(request);
      if (lookingChanged) {
        await hubAPI.setLookingForJob({ looking_for_job: looking });
      }
      return request.ideal_job;
    },
    onSuccess: async (idealJob) => {
      setText(idealJob);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({ queryKey: openingSearchQueryKey }),
      ]);
      void message.success({ key: "setup", content: t("setup.saved") });
      onAdvance(idealJob !== "");
    },
  });

  function submit() {
    if (!isIdealJobValid(text) || save.isPending) return;
    if (dirty) {
      save.mutate();
    } else if (saved !== "") {
      onAdvance(true);
    } else {
      setMissing(true);
    }
  }

  return (
    <Form layout="vertical">
      <IdealJobField
        value={text}
        error={missing && !dirty ? t("setup.idealJobMissing") : undefined}
        onChange={(value) => {
          setText(value);
          setMissing(false);
        }}
      />
      <Flex vertical gap="middle">
        <Checkbox
          checked={looking}
          onChange={(event) => setLooking(event.target.checked)}
        >
          {t("preferences.lookingForJob")}{" "}
          <Typography.Text type="secondary">
            {t("setup.onlyYou")}
          </Typography.Text>
        </Checkbox>
        <APIErrorAlert error={save.error} />
        <StepActions
          label={t("setup.saveAndContinue")}
          onContinue={submit}
          onSkip={saved === "" ? onSkip : undefined}
          pending={save.isPending}
          dirty={dirty}
        />
      </Flex>
    </Form>
  );
}
