import { Space, Switch, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import type { AdminPermissionID } from "../../../../typespec/admin/authorization/types.ts";
import {
  type PermissionRow,
  permissionDescriptionKey,
  permissionNameKey,
  permissionRows,
  togglePermission,
} from "./permissions";

/**
 * Value and change props are optional so an Ant Design `Form.Item` can supply
 * them, and are named the way that binding requires.
 */
interface PermissionTableProps {
  value?: readonly AdminPermissionID[];
  disabled?: boolean;
  onChange?: (permissions: AdminPermissionID[]) => void;
}

export function PermissionTable({
  value = [],
  disabled = false,
  onChange,
}: PermissionTableProps) {
  const { t } = useTranslation();
  const rows = permissionRows(value);

  const columns: ColumnsType<PermissionRow> = [
    {
      title: t("fields.permission"),
      key: "permission",
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>
            {row.defined
              ? t(permissionNameKey(row.permission))
              : row.permission}
          </Typography.Text>
          <Typography.Text type="secondary">
            {row.defined
              ? t(permissionDescriptionKey(row.permission))
              : t("permissions.unknown.description")}
          </Typography.Text>
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
      title: t("fields.granted"),
      key: "granted",
      width: 120,
      align: "center",
      render: (_, row) => (
        <Switch
          checked={row.selected || row.impliedBy.length > 0}
          disabled={disabled || row.impliedBy.length > 0}
          aria-label={
            row.defined ? t(permissionNameKey(row.permission)) : row.permission
          }
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
