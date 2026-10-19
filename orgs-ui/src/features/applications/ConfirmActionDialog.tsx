import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Modal, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import { isDefiniteRefusal } from "../../api/client";
import { applicationErrorMessage } from "./errors";
import {
  useCompleteApplicationStageMutation,
  useRecordDidNotJoinMutation,
  useWithdrawOfferMutation,
} from "./queries";

export type ConfirmAction =
  | "complete-stage"
  | "did-not-join"
  | "withdraw-offer";

interface Props {
  action: ConfirmAction;
  detail: ApplicationDetail;
  openingNumber: number;
  onClose: () => void;
}

export function ConfirmActionDialog({
  action,
  detail,
  openingNumber,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const complete = useCompleteApplicationStageMutation();
  const didNotJoin = useRecordDidNotJoinMutation();
  const withdraw = useWithdrawOfferMutation();
  const key = useIdempotencyKey(
    `confirm-${action}:${openingNumber}:${detail.application_number}`,
  );
  const [error, setError] = useState<string>();
  const pending =
    complete.isPending || didNotJoin.isPending || withdraw.isPending;

  const submit = async () => {
    if (pending) return;
    setError(undefined);
    const request = {
      opening_number: openingNumber,
      application_number: detail.application_number,
      version: detail.version,
    };
    try {
      if (action === "complete-stage") {
        await complete.mutateAsync({ request, key: key.current() });
      } else if (action === "withdraw-offer") {
        await withdraw.mutateAsync({ request, key: key.current() });
      } else {
        await didNotJoin.mutateAsync({ request, key: key.current() });
      }
      key.rotate();
      void message.success(t(`applications.confirm.${action}.done`));
      onClose();
    } catch (cause) {
      setError(applicationErrorMessage(t, cause));
      if (isDefiniteRefusal(cause)) key.rotate();
    }
  };

  return (
    <Modal
      open
      title={t(`applications.confirm.${action}.title`)}
      okText={t(`applications.confirm.${action}.confirm`)}
      okButtonProps={{ danger: action !== "complete-stage" }}
      cancelText={t("common.cancel")}
      onCancel={() => {
        if (!pending) onClose();
      }}
      onOk={() => void submit()}
      confirmLoading={pending}
      closable={!pending}
      keyboard={!pending}
      cancelButtonProps={{ disabled: pending }}
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
        {t(`applications.confirm.${action}.body`, {
          stage: detail.current_stage?.name ?? "",
        })}
      </Typography.Paragraph>
    </Modal>
  );
}
