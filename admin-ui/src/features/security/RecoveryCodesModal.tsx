import { Alert, List, Modal, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { TOTPRecoveryCode } from "../../../../typespec/common/authentication.ts";

interface RecoveryCodesModalProps {
  codes: TOTPRecoveryCode[] | null;
  onClose: () => void;
}

export function RecoveryCodesModal({
  codes,
  onClose,
}: RecoveryCodesModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={codes !== null}
      destroyOnHidden
      title={t("security.recoveryCodes.title")}
      okText={t("security.recoveryCodes.saved")}
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
          title={t("security.recoveryCodes.warning")}
          description={t("security.recoveryCodes.description")}
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
          {t("security.recoveryCodes.copyAll")}
        </Typography.Text>
      </Space>
    </Modal>
  );
}
