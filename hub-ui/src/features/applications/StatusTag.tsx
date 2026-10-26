import { Tag } from "antd";
import { useTranslation } from "react-i18next";
import {
  type ApplicationStatus,
  isApplicationStatus,
} from "typespec/hub/applications/applications";
import { statusColors } from "./presentation";

export function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation();
  // A status newer than this portal shows as its raw value.
  if (!isApplicationStatus(status)) return <Tag>{status}</Tag>;
  return (
    <Tag color={statusColors[status as ApplicationStatus]}>
      {t(`applications.status.${status}`)}
    </Tag>
  );
}
