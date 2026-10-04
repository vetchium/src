import { Space, Switch, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import type { OrgPermissionID } from "typespec/orgs/authorization/types";
import {
  type PermissionRow,
  permissionDescriptionKey,
  permissionNameKey,
  permissionRows,
  togglePermission,
} from "./roles";

/**
 * Value and change props are optional so an Ant Design `Form.Item` can supply
 * them, and are named the way that binding requires.
 */
interface PermissionTableProps {
  value?: readonly OrgPermissionID[];
  disabled?: boolean;
  /** Permissions the viewer may not turn on or off. */
  locked?: (permission: OrgPermissionID) => boolean;
  onChange?: (permissions: OrgPermissionID[]) => void;
}

export function PermissionTable({
  value = [],
  disabled = false,
  locked,
  onChange,
}: PermissionTableProps) {
  const { t } = useTranslation();
  const rows = permissionRows(value);
  const label = (row: PermissionRow) =>
    row.defined ? t(permissionNameKey(row.permission)) : row.permission;

  const columns: ColumnsType<PermissionRow> = [
    {
      title: t("fields.permissions"),
      key: "permission",
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Tag>{label(row)}</Tag>
          <Typography.Text type="secondary">
            {row.defined
              ? t(permissionDescriptionKey(row.permission))
              : t("permissions.unknown.description")}
          </Typography.Text>
          {locked?.(row.permission) ? (
            <Typography.Text type="secondary">
              {t("people.restricted")}
            </Typography.Text>
          ) : null}
          {row.impliedBy.length === 0 ? null : (
            <Tag color="blue">
              {t("permissions.includedBy", {
                permission: t(permissionNameKey(row.impliedBy[0] ?? "")),
              })}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t("users.permissionGranted"),
      key: "granted",
      width: 120,
      align: "center",
      render: (_, row) => (
        <Switch
          checked={row.selected || row.impliedBy.length > 0}
          disabled={
            disabled || row.impliedBy.length > 0 || locked?.(row.permission)
          }
          aria-label={label(row)}
          onChange={(granted) =>
            onChange?.(togglePermission(value, row.permission, granted))
          }
        />
      ),
    },
  ];

  return (
    <Table<PermissionRow>
      rowKey="permission"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={false}
    />
  );
}
