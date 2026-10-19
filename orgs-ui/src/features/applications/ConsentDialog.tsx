import { Alert, Checkbox, Flex, Form, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import { maxCheckTypes } from "typespec/orgs/applications/applications";
import {
  type CheckType,
  checkTypeValues,
} from "typespec/orgs/hiring/vocabulary";
import { ActionDialog } from "./ActionDialog";
import { useRequestConsentMutation } from "./queries";

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  /** An earlier request was declined or ended, so this asks again. */
  again: boolean;
  onClose: () => void;
}

/** Asks the applicant to consent to the chosen checks; nothing can be
 * recorded until they agree in the Hub. */
export function ConsentDialog({
  detail,
  openingNumber,
  again,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const request = useRequestConsentMutation();
  const [types, setTypes] = useState<CheckType[]>([]);

  return (
    <ActionDialog
      keyName={`consent-request:${openingNumber}:${detail.application_number}`}
      title={t(
        again
          ? "applications.consent.againTitle"
          : "applications.consent.title",
      )}
      okText={t("applications.consent.confirm")}
      doneMessage={t("applications.consent.done")}
      valid={types.length >= 1 && types.length <= maxCheckTypes}
      fingerprint={[...types].sort().join(",")}
      submit={(key) =>
        request.mutateAsync({
          request: {
            opening_number: openingNumber,
            application_number: detail.application_number,
            version: detail.version,
            check_types: types,
          },
          key,
        })
      }
      onClose={onClose}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={t("applications.consent.rule")}
      />
      <Form layout="vertical" component="div">
        <Form.Item label={t("applications.consent.checks")} required>
          <Checkbox.Group
            value={types}
            onChange={(values) => setTypes(values as CheckType[])}
          >
            <Flex vertical gap="small">
              {checkTypeValues.map((value) => (
                <Checkbox key={value} value={value}>
                  {t(`applications.work.checkTypes.${value}`)}
                </Checkbox>
              ))}
            </Flex>
          </Checkbox.Group>
        </Form.Item>
        <Typography.Text type="secondary">
          {t("applications.consent.noFiles")}
        </Typography.Text>
      </Form>
    </ActionDialog>
  );
}
