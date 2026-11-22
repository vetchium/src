import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { localized } from "@vetchium/portal-ui/localized";
import { Alert, App, Modal, Typography } from "antd";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { isDefiniteRefusal } from "../../api/client";
import { applicationErrorMessage } from "./errors";
import { applicantName } from "./presentation";
import { useNotProgressingMutation } from "./queries";
import type { ApplicationTarget } from "./ShortlistDialog";

interface Props {
  openingNumber: number;
  application: ApplicationTarget;
  /** The application is a candidacy, so interviews and offers end too. */
  candidacy: boolean;
  onClose: () => void;
}

export function NotProgressingDialog({
  openingNumber,
  application,
  candidacy,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const mutation = useNotProgressingMutation();
  const key = useIdempotencyKey(
    `not-progressing:${openingNumber}:${application.application_number}`,
  );
  const [error, setError] = useState<ReactNode>();
  const name = applicantName(t, application);

  const submit = async () => {
    if (mutation.isPending) return;
    setError(undefined);
    try {
      await mutation.mutateAsync({
        request: {
          opening_number: openingNumber,
          application_number: application.application_number,
          version: application.version,
        },
        key: key.current(),
      });
      key.rotate();
      void message.success(t("applications.notProgressing.done", { name }));
      onClose();
    } catch (cause) {
      setError(localized((t) => applicationErrorMessage(t, cause)));
      if (isDefiniteRefusal(cause)) key.rotate();
    }
  };

  return (
    <Modal
      open
      title={t("applications.notProgressing.title", { name })}
      okText={t("applications.notProgressing.confirm")}
      okButtonProps={{ danger: true }}
      cancelText={t("common.cancel")}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      onOk={() => void submit()}
      confirmLoading={mutation.isPending}
      closable={!mutation.isPending}
      keyboard={!mutation.isPending}
      cancelButtonProps={{ disabled: mutation.isPending }}
      destroyOnHidden
    >
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 16 }}
        />
      )}
      <Typography.Paragraph>
        {t("applications.notProgressing.body", { name })}
      </Typography.Paragraph>
      {candidacy && (
        <Typography.Paragraph type="secondary">
          {t("applications.notProgressing.candidacy")}
        </Typography.Paragraph>
      )}
      <Typography.Paragraph type="secondary">
        {t("applications.notProgressing.final")}
      </Typography.Paragraph>
    </Modal>
  );
}
