import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Modal } from "antd";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IdempotencyKey } from "typespec/common/idempotency";
import { isDefiniteRefusal } from "../../api/client";
import { applicationErrorMessage } from "./errors";

interface Props {
  /** Names the idempotency key; one per application and action. */
  keyName: string;
  title: string;
  okText: string;
  doneMessage: string;
  valid?: boolean;
  danger?: boolean;
  /** Changes whenever the request body would, so an edited form never reuses
   * the key of an attempt that may still be in flight. */
  fingerprint: string;
  submit: (key: IdempotencyKey) => Promise<unknown>;
  onClose: () => void;
  width?: number;
  /** Shown above the form, for warnings the user should read first. */
  notice?: ReactNode;
  /** Sees each refusal, to mark the fields it names. */
  onRefused?: (cause: unknown) => void;
  children: ReactNode;
}

/**
 * The shell every stage-work dialog shares: it sends one request under a key
 * that survives retries, shows the API's specific refusal in place, and
 * closes on success.
 */
export function ActionDialog({
  keyName,
  title,
  okText,
  doneMessage,
  valid = true,
  danger,
  fingerprint,
  submit,
  onClose,
  width,
  notice,
  onRefused,
  children,
}: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const key = useIdempotencyKey(keyName);
  const sent = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const run = async () => {
    if (!valid || pending) return;
    if (sent.current !== undefined && sent.current !== fingerprint) {
      key.rotate();
    }
    sent.current = fingerprint;
    setError(undefined);
    setPending(true);
    try {
      await submit(key.current());
      key.rotate();
      void message.success(doneMessage);
      onClose();
    } catch (cause) {
      setError(applicationErrorMessage(t, cause));
      onRefused?.(cause);
      if (isDefiniteRefusal(cause)) key.rotate();
      setPending(false);
    }
  };

  return (
    <Modal
      open
      title={title}
      okText={okText}
      okButtonProps={{ disabled: !valid, danger }}
      cancelText={t("common.cancel")}
      onCancel={() => {
        if (!pending) onClose();
      }}
      onOk={() => void run()}
      confirmLoading={pending}
      closable={!pending}
      keyboard={!pending}
      cancelButtonProps={{ disabled: pending }}
      width={width}
      destroyOnHidden
    >
      {notice}
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 16 }}
        />
      )}
      {children}
    </Modal>
  );
}
