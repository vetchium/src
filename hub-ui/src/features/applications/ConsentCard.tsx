import { Button, Card, Modal, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationReference,
  MyBackgroundCheckConsent,
} from "typespec/hub/applications/applications";
import { hubAPI } from "../../api/hub";
import { ActionError } from "./ActionError";
import { useApplicationAction } from "./actions";

export function ConsentCard({
  reference,
  orgName,
  consent,
}: {
  reference: ApplicationReference;
  orgName: string;
  consent: MyBackgroundCheckConsent;
}) {
  const { t } = useTranslation();
  const [declining, setDeclining] = useState(false);
  const give = useApplicationAction((number: number, key) =>
    hubAPI.giveApplicationBackgroundCheckConsent(
      { ...reference, check_number: number },
      key,
    ),
  );
  const decline = useApplicationAction((number: number, key) =>
    hubAPI.declineApplicationBackgroundCheckConsent(
      { ...reference, check_number: number },
      key,
    ),
  );
  return (
    <Card title={t("applications.consent.title")}>
      <Space orientation="vertical" className="full-width">
        <Typography.Paragraph>
          {t("applications.consent.body", { org: orgName })}
        </Typography.Paragraph>
        <Space wrap>
          {consent.check_types.map((type) => (
            <Tag key={type}>{t(`applications.checkTypes.${type}`, type)}</Tag>
          ))}
        </Space>
        <Typography.Text type="secondary">
          {t(`applications.consent.performer.${consent.performer}`, {
            org: orgName,
            defaultValue: t("applications.consent.performer.other", {
              org: orgName,
            }),
          })}
        </Typography.Text>
        <Space wrap>
          <Button
            type="primary"
            loading={give.isPending}
            disabled={decline.isPending}
            onClick={() => give.mutate(consent.check_number)}
          >
            {t("applications.consent.give")}
          </Button>
          <Button disabled={give.isPending} onClick={() => setDeclining(true)}>
            {t("applications.consent.decline")}
          </Button>
        </Space>
        <ActionError error={give.error} />
      </Space>
      <Modal
        open={declining}
        title={t("applications.consent.declineTitle")}
        okText={t("applications.consent.decline")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        confirmLoading={decline.isPending}
        onOk={() =>
          decline.mutate(consent.check_number, {
            onSuccess: () => setDeclining(false),
          })
        }
        onCancel={() => {
          setDeclining(false);
          decline.reset();
        }}
      >
        <Typography.Paragraph>
          {t("applications.consent.declineBody", { org: orgName })}
        </Typography.Paragraph>
        <ActionError error={decline.error} />
      </Modal>
    </Card>
  );
}
