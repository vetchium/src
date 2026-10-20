import { FilePdfOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Button,
  Card,
  Descriptions,
  Modal,
  Space,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationReference,
  MyApplicationOffer,
} from "typespec/hub/applications/applications";
import { hubAPI } from "../../api/hub";
import { ActionError } from "./ActionError";
import { useApplicationAction } from "./actions";

type Response = "accept" | "decline";

export function OfferCard({
  reference,
  orgName,
  offer,
  answerable,
  readLetterURL,
}: {
  reference: ApplicationReference;
  orgName: string;
  offer: MyApplicationOffer;
  /** The application is still `offered`; the API refuses anything else. */
  answerable: boolean;
  /** Reads the application again for a fresh letter link. */
  readLetterURL: () => Promise<string | undefined>;
}) {
  const { t } = useTranslation();
  const { date, dateTime } = useDateTimeFormat();
  const [confirming, setConfirming] = useState<Response | null>(null);
  const [opening, setOpening] = useState(false);
  const accept = useApplicationAction((number: number, key) =>
    hubAPI.acceptApplicationOffer({ ...reference, offer_number: number }, key),
  );
  const decline = useApplicationAction((number: number, key) =>
    hubAPI.declineApplicationOffer({ ...reference, offer_number: number }, key),
  );
  const action = confirming === "accept" ? accept : decline;
  const canRespond =
    answerable &&
    offer.status === "extended" &&
    Date.parse(offer.respond_by) > Date.now();
  // The Org's tenant moves the application when the deadline passes; until
  // then the offer must not read as open.
  const statusKey =
    offer.status === "extended" && Date.parse(offer.respond_by) <= Date.now()
      ? "expired"
      : offer.status;
  // The letter link expires after ten minutes, so it is read again on click.
  const openLetter = async () => {
    setOpening(true);
    try {
      const url = await readLetterURL();
      if (url !== undefined) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setOpening(false);
    }
  };
  return (
    <Card
      title={
        <Space wrap>
          {t("applications.offer.title")}
          {canRespond ? (
            <Tag color="warning">
              {t("applications.interviews.needsAnswer")}
            </Tag>
          ) : (
            <Tag>{t(`applications.offer.status.${statusKey}`, statusKey)}</Tag>
          )}
        </Space>
      }
    >
      <Space orientation="vertical" className="full-width">
        <Descriptions column={1} size="small">
          <Descriptions.Item label={t("applications.offer.respondBy")}>
            {dateTime(offer.respond_by)}
          </Descriptions.Item>
          {offer.proposed_joining_date ? (
            <Descriptions.Item label={t("applications.offer.joiningDate")}>
              {date(offer.proposed_joining_date)}
            </Descriptions.Item>
          ) : null}
        </Descriptions>
        <Button
          icon={<FilePdfOutlined />}
          loading={opening}
          onClick={() => void openLetter()}
        >
          {t("applications.offer.letter")}
        </Button>
        {canRespond ? (
          <Space wrap>
            <Button type="primary" onClick={() => setConfirming("accept")}>
              {t("applications.offer.accept")}
            </Button>
            <Button onClick={() => setConfirming("decline")}>
              {t("applications.offer.decline")}
            </Button>
          </Space>
        ) : null}
      </Space>
      <Modal
        open={confirming !== null}
        title={t(`applications.offer.${confirming ?? "accept"}Title`)}
        okText={t(`applications.offer.${confirming ?? "accept"}`)}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: confirming === "decline" }}
        confirmLoading={action.isPending}
        onOk={() =>
          action.mutate(offer.offer_number, {
            onSuccess: () => setConfirming(null),
          })
        }
        onCancel={() => {
          setConfirming(null);
          accept.reset();
          decline.reset();
        }}
      >
        <Typography.Paragraph>
          {t(`applications.offer.${confirming ?? "accept"}Body`, {
            org: orgName,
          })}
        </Typography.Paragraph>
        <ActionError error={action.error} />
      </Modal>
    </Card>
  );
}
