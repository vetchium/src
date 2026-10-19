import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Form, Modal, Radio, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import { isDefiniteRefusal } from "../../api/client";
import { applicationErrorMessage } from "./errors";
import { applicantName, stageText } from "./presentation";
import { useShortlistApplicationMutation } from "./queries";

export interface ApplicationTarget {
  application_number: number;
  version: number;
  display_name: string;
  removed: boolean;
}

interface Props {
  openingNumber: number;
  application: ApplicationTarget;
  stages: readonly PipelineStage[];
  onClose: () => void;
  onDone?: () => void;
}

/** Shortlisting makes the applicant a candidate at the chosen stage. */
export function ShortlistDialog({
  openingNumber,
  application,
  stages,
  onClose,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const shortlist = useShortlistApplicationMutation();
  const key = useIdempotencyKey(
    `shortlist:${openingNumber}:${application.application_number}`,
  );
  const [stageID, setStageID] = useState(stages[0]?.id);
  const [error, setError] = useState<string>();
  const name = applicantName(t, application);
  const chosen = stages.find((stage) => stage.id === stageID);

  const submit = async () => {
    if (stageID === undefined || shortlist.isPending) return;
    setError(undefined);
    try {
      await shortlist.mutateAsync({
        request: {
          opening_number: openingNumber,
          application_number: application.application_number,
          version: application.version,
          stage_id: stageID,
        },
        key: key.current(),
      });
      key.rotate();
      void message.success(t("applications.shortlist.done", { name }));
      onDone?.();
      onClose();
    } catch (cause) {
      setError(applicationErrorMessage(t, cause));
      if (isDefiniteRefusal(cause)) key.rotate();
    }
  };

  return (
    <Modal
      open
      title={t("applications.shortlist.title", { name })}
      okText={t("applications.shortlist.confirm")}
      cancelText={t("common.cancel")}
      onCancel={() => {
        if (!shortlist.isPending) onClose();
      }}
      onOk={() => void submit()}
      okButtonProps={{ disabled: stageID === undefined }}
      confirmLoading={shortlist.isPending}
      closable={!shortlist.isPending}
      keyboard={!shortlist.isPending}
      cancelButtonProps={{ disabled: shortlist.isPending }}
      destroyOnHidden
    >
      <Form layout="vertical" component="div">
        <Typography.Paragraph>
          {t("applications.shortlist.intro", { name })}
        </Typography.Paragraph>
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form.Item label={t("applications.shortlist.stage")} required>
          <Radio.Group
            orientation="vertical"
            value={stageID}
            disabled={shortlist.isPending}
            onChange={(event) => {
              key.rotate();
              setStageID(event.target.value);
            }}
            options={stages.map((stage) => ({
              value: stage.id,
              label: stageText(t, stage),
            }))}
          />
        </Form.Item>
        {chosen && (
          <Typography.Text type="secondary">
            {t(
              chosen.kind === "interview"
                ? "applications.shortlist.seesInterviewing"
                : "applications.shortlist.seesInReview",
              { name },
            )}
          </Typography.Text>
        )}
      </Form>
    </Modal>
  );
}
