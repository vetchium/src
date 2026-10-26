import { UploadOutlined } from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Typography,
  Upload,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import {
  isCalendarDate,
  isPDF,
  maxOfferLetterBytes,
} from "typespec/orgs/applications/applications";
import { orgsAPI } from "../../api/orgs";
import { ActionDialog } from "./ActionDialog";
import { utcToday } from "./presentation";
import { useExtendOfferMutation } from "./queries";

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  onClose: () => void;
}

const defaultResponseDays = 14;

/**
 * Extends an offer in two calls: the letter is uploaded first, then claimed
 * by the offer. A retry after a refusal uploads again, so a letter the API
 * refused is never reused.
 */
export function OfferDialog({ detail, openingNumber, onClose }: Props) {
  const { t } = useTranslation();
  const extend = useExtendOfferMutation();
  const letterKey = useIdempotencyKey(
    `offer-letter:${openingNumber}:${detail.application_number}`,
  );
  const [letter, setLetter] = useState<File>();
  const [letterError, setLetterError] = useState<string>();
  const [joining, setJoining] = useState("");
  const [days, setDays] = useState<number | null>(defaultResponseDays);
  const uploaded = useRef<{ file: File; id: string } | undefined>(undefined);
  const overHiring = detail.joined_count >= detail.positions;
  const today = utcToday();
  const joiningValid =
    joining === "" || (isCalendarDate(joining) && joining >= today);
  const valid =
    letter !== undefined &&
    letterError === undefined &&
    joiningValid &&
    days !== null &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= 60;

  const choose = async (file: File) => {
    uploaded.current = undefined;
    letterKey.rotate();
    setLetter(undefined);
    if (file.size > maxOfferLetterBytes) {
      setLetterError(t("applications.errors.letterTooLarge"));
      return;
    }
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (!isPDF(head)) {
      setLetterError(t("applications.errors.letterInvalid"));
      return;
    }
    setLetterError(undefined);
    setLetter(file);
  };

  return (
    <ActionDialog
      keyName={`offer-extend:${openingNumber}:${detail.application_number}`}
      title={t("applications.offer.title")}
      okText={t("applications.offer.confirm")}
      doneMessage={t("applications.offer.done")}
      valid={valid}
      fingerprint={JSON.stringify([
        letter?.name,
        letter?.size,
        letter?.lastModified,
        joining,
        days,
      ])}
      notice={
        overHiring ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title={t("applications.offer.overHiring", {
              joined: detail.joined_count,
              positions: detail.positions,
            })}
          />
        ) : undefined
      }
      submit={async (key) => {
        if (letter === undefined || days === null) return;
        try {
          if (uploaded.current?.file !== letter) {
            const result = await orgsAPI.uploadOfferLetter(
              letter,
              letterKey.current(),
            );
            uploaded.current = { file: letter, id: result.letter_id };
          }
          return await extend.mutateAsync({
            request: {
              opening_number: openingNumber,
              application_number: detail.application_number,
              version: detail.version,
              letter_id: uploaded.current.id,
              respond_within_days: days,
              ...(joining !== "" && { proposed_joining_date: joining }),
            },
            key,
          });
        } catch (cause) {
          uploaded.current = undefined;
          letterKey.rotate();
          throw cause;
        }
      }}
      onClose={onClose}
    >
      <Form layout="vertical" component="div">
        <Form.Item
          label={t("applications.offer.letter")}
          required
          extra={t("applications.offer.letterHelp")}
          validateStatus={letterError ? "error" : undefined}
          help={letterError}
        >
          <Upload
            accept="application/pdf,.pdf"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(file) => {
              void choose(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined aria-hidden />}>
              {t(
                letter
                  ? "applications.offer.replaceLetter"
                  : "applications.offer.chooseLetter",
              )}
            </Button>
          </Upload>
          {letter && (
            <Typography.Text
              type="secondary"
              style={{ display: "block", marginTop: 8 }}
            >
              {letter.name}
            </Typography.Text>
          )}
        </Form.Item>
        <Form.Item
          label={t("applications.offer.respondWithin")}
          required
          extra={t("applications.offer.respondHelp")}
        >
          <InputNumber
            min={1}
            max={60}
            precision={0}
            value={days}
            onChange={setDays}
            addonAfter={t("applications.offer.days")}
            aria-label={t("applications.offer.respondWithin")}
          />
        </Form.Item>
        <Form.Item
          label={t("applications.offer.joiningDate")}
          extra={t("applications.offer.joiningHelp")}
          validateStatus={joiningValid ? undefined : "error"}
          help={
            joiningValid
              ? undefined
              : t("applications.errors.invalidProposedDate")
          }
        >
          <Input
            type="date"
            value={joining}
            min={today}
            onChange={(event) => setJoining(event.target.value)}
            aria-label={t("applications.offer.joiningDate")}
          />
        </Form.Item>
      </Form>
    </ActionDialog>
  );
}
