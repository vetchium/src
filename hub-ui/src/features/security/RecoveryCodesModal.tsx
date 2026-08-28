import { Alert, List, Modal, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { TOTPRecoveryCode } from "../../../../typespec/common/authentication.ts";

export function RecoveryCodesModal({
  codes,
  onClose,
}: {
  codes: TOTPRecoveryCode[] | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={codes !== null}
      destroyOnHidden
      title={t("recoveryCodes.title")}
      okText={t("recoveryCodes.saved")}
      footer={(_, { OkBtn }) => <OkBtn />}
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      onOk={onClose}
    >
      <Space orientation="vertical" size="middle" className="full-width">
        <Alert
          type="warning"
          showIcon
          title={t("recoveryCodes.warning")}
          description={t("recoveryCodes.description")}
        />
        <List<TOTPRecoveryCode>
          bordered
          size="small"
          rowKey={(code) => code}
          dataSource={codes ?? []}
          renderItem={(code) => (
            <List.Item>
              <Typography.Text code copyable>
                {code}
              </Typography.Text>
            </List.Item>
          )}
        />
        <Typography.Text copyable={{ text: (codes ?? []).join("\n") }}>
          {t("recoveryCodes.copyAll")}
        </Typography.Text>
      </Space>
    </Modal>
  );
}
