import { Alert, List, Modal, Space, Typography } from "antd";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TOTPRecoveryCode } from "typespec/common/authentication";
import { useHoldNavigation } from "./pending-operations";

interface RecoveryCodesValue {
  show: (codes: TOTPRecoveryCode[], forSession: string) => void;
}

const RecoveryCodesContext = createContext<RecoveryCodesValue | null>(null);

function RecoveryCodesModal({
  codes,
  onClose,
  translationPrefix,
}: {
  codes: TOTPRecoveryCode[] | null;
  onClose: () => void;
  translationPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={codes !== null}
      destroyOnHidden
      title={t(`${translationPrefix}.title`)}
      okText={t(`${translationPrefix}.saved`)}
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
          title={t(`${translationPrefix}.warning`)}
          description={t(`${translationPrefix}.description`)}
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
          {t(`${translationPrefix}.copyAll`)}
        </Typography.Text>
      </Space>
    </Modal>
  );
}

/** Keeps one-time recovery codes bound to the session that requested them. */
export function RecoveryCodesProvider({
  children,
  sessionToken,
  translationPrefix,
}: PropsWithChildren<{
  sessionToken: string | null;
  translationPrefix: string;
}>) {
  const [issued, setIssued] = useState<{
    codes: TOTPRecoveryCode[];
    session: string;
  } | null>(null);
  const codes =
    issued !== null && issued.session === sessionToken ? issued.codes : null;

  useEffect(() => {
    if (issued !== null && issued.session !== sessionToken) setIssued(null);
  }, [issued, sessionToken]);
  useHoldNavigation(codes !== null);

  const value = useMemo<RecoveryCodesValue>(
    () => ({
      show: (shown, forSession) =>
        setIssued({ codes: shown, session: forSession }),
    }),
    [],
  );
  return (
    <RecoveryCodesContext.Provider value={value}>
      {children}
      <RecoveryCodesModal
        codes={codes}
        translationPrefix={translationPrefix}
        onClose={() => setIssued(null)}
      />
    </RecoveryCodesContext.Provider>
  );
}

export function useRecoveryCodes(): RecoveryCodesValue {
  const value = useContext(RecoveryCodesContext);
  if (value === null) throw new Error("RecoveryCodesProvider is missing");
  return value;
}
