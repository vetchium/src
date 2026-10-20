import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { OperationStillPendingError } from "./actions";

export function ActionError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error instanceof OperationStillPendingError) {
    return (
      <Alert type="info" showIcon title={t("applications.stillPending")} />
    );
  }
  return <APIErrorAlert error={error} />;
}
