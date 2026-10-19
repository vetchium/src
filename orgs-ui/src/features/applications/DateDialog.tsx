import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Form, Input, Modal, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import { isCalendarDate } from "typespec/orgs/applications/applications";
import { isDefiniteRefusal } from "../../api/client";
import { applicationErrorMessage } from "./errors";
import { utcToday } from "./presentation";
import {
  useCorrectJoinedOnMutation,
  useCorrectSeparatedOnMutation,
  useRecordJoinedMutation,
  useRecordSeparatedMutation,
} from "./queries";

export type DateAction =
  | "record-joined"
  | "record-separated"
  | "correct-joined"
  | "correct-separated";

interface Props {
  action: DateAction;
  detail: ApplicationDetail;
  openingNumber: number;
  onClose: () => void;
}

/** Records or corrects a joining or separation date, which are facts the
 * Org states: the API judges them against the offer and each other. */
export function DateDialog({ action, detail, openingNumber, onClose }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const recordJoined = useRecordJoinedMutation();
  const recordSeparated = useRecordSeparatedMutation();
  const correctJoined = useCorrectJoinedOnMutation();
  const correctSeparated = useCorrectSeparatedOnMutation();
  const key = useIdempotencyKey(
    `date-${action}:${openingNumber}:${detail.application_number}`,
  );
  const today = utcToday();
  const initial =
    action === "correct-joined"
      ? detail.joined_on
      : action === "correct-separated"
        ? detail.separated_on
        : action === "record-joined"
          ? today
          : undefined;
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string>();
  const pending =
    recordJoined.isPending ||
    recordSeparated.isPending ||
    correctJoined.isPending ||
    correctSeparated.isPending;
  const joined = action === "record-joined" || action === "correct-joined";
  const overHiring =
    action === "record-joined" && detail.joined_count >= detail.positions;
  const valid = isCalendarDate(value) && value.length === 10;

  const submit = async () => {
    if (!valid || pending) return;
    setError(undefined);
    const base = {
      opening_number: openingNumber,
      application_number: detail.application_number,
      version: detail.version,
    };
    try {
      if (action === "record-joined") {
        await recordJoined.mutateAsync({
          request: { ...base, joined_on: value },
          key: key.current(),
        });
      } else if (action === "correct-joined") {
        await correctJoined.mutateAsync({
          request: { ...base, joined_on: value },
          key: key.current(),
        });
      } else if (action === "record-separated") {
        await recordSeparated.mutateAsync({
          request: { ...base, separated_on: value },
          key: key.current(),
        });
      } else {
        await correctSeparated.mutateAsync({
          request: { ...base, separated_on: value },
          key: key.current(),
        });
      }
      key.rotate();
      void message.success(t("applications.dates.saved"));
      onClose();
    } catch (cause) {
      setError(applicationErrorMessage(t, cause));
      if (isDefiniteRefusal(cause)) key.rotate();
    }
  };

  return (
    <Modal
      open
      title={t(`applications.dates.${action}.title`)}
      okText={t(`applications.dates.${action}.confirm`)}
      cancelText={t("common.cancel")}
      onCancel={() => {
        if (!pending) onClose();
      }}
      onOk={() => void submit()}
      okButtonProps={{ disabled: !valid }}
      confirmLoading={pending}
      closable={!pending}
      keyboard={!pending}
      cancelButtonProps={{ disabled: pending }}
      destroyOnHidden
    >
      <Form layout="vertical" component="div">
        {overHiring && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title={t("applications.dates.overHiring", {
              joined: detail.joined_count,
              positions: detail.positions,
            })}
          />
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form.Item
          label={t(
            joined
              ? "applications.dates.joinedOn"
              : "applications.dates.separatedOn",
          )}
          required={action.startsWith("record")}
          extra={t(`applications.dates.${action}.help`)}
        >
          <Input
            type="date"
            value={value}
            max={joined ? today : undefined}
            min={!joined ? detail.joined_on : undefined}
            onChange={(event) => {
              key.rotate();
              setValue(event.target.value);
            }}
            aria-label={t(
              joined
                ? "applications.dates.joinedOn"
                : "applications.dates.separatedOn",
            )}
          />
        </Form.Item>
        <Typography.Text type="secondary">
          {t("applications.dates.utc")}
        </Typography.Text>
      </Form>
    </Modal>
  );
}
