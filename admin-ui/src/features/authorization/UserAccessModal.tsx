import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Descriptions, Modal, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AdminPermissionID } from "../../../../typespec/admin/authorization/types.ts";
import type { AdminUserSummary } from "../../../../typespec/admin/users/management.ts";
import {
  AdminUserNotFoundError,
  LastAdminManagerError,
} from "../../../../typespec/problem/admin/users.ts";
import { isRecentAuthenticationRequired } from "../../api/client";
import { problemTranslationKey } from "../../api/problems";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";
import { usersQueryKey } from "../users/queries";
import { setPermissions } from "./api";
import { PermissionTable } from "./PermissionTable";
import { permissionGrants, samePermissions } from "./permissions";

interface UserAccessModalProps {
  user: AdminUserSummary | null;
  editingSelf: boolean;
  onClose: () => void;
}

const accessProblems = {
  [AdminUserNotFoundError.type]: "users.errors.notFound",
  [LastAdminManagerError.type]: "users.errors.lastManager",
};

export function UserAccessModal({
  user,
  editingSelf,
  onClose,
}: UserAccessModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: setPermissions });
  // Seeded once for the administrator this modal was mounted for, so a list
  // refresh arriving while it is open cannot overwrite unsaved edits. The
  // caller remounts the modal per target.
  const [draft, setDraft] = useState<AdminPermissionID[]>(
    user?.permissions ?? [],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
  };

  const save = async () => {
    if (user === null || mutation.isPending) return;
    try {
      await mutation.mutateAsync({
        admin_user_id: user.admin_user_id,
        permissions: permissionGrants(draft),
      });
      onClose();
      void message.success(t("users.access.saved"));
    } catch (error) {
      if (!isRecentAuthenticationRequired(error)) {
        void message.error(t(problemTranslationKey(error, accessProblems)));
      }
    } finally {
      refresh();
    }
  };

  const displayName =
    user?.display_names.find(
      (name) => name.language_code === user.primary_display_name_language,
    )?.display_name ?? user?.email_address;
  const changed = user !== null && !samePermissions(draft, user.permissions);

  return (
    <Modal
      open={user !== null}
      destroyOnHidden
      width={640}
      title={t("users.access.title")}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: !changed }}
      cancelButtonProps={{ disabled: mutation.isPending }}
      closable={!mutation.isPending}
      keyboard={!mutation.isPending}
      mask={{ closable: !mutation.isPending }}
      onOk={() => void save()}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      {user === null ? null : (
        <Space orientation="vertical" size="large" className="full-width">
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: "name",
                label: t("fields.name"),
                children: displayName,
              },
              {
                key: "email",
                label: t("fields.email"),
                children: user.email_address,
              },
              {
                key: "security",
                label: t("fields.twoFactor"),
                children: (
                  <Tag color={user.totp_enabled ? "green" : "orange"}>
                    {t(
                      user.totp_enabled ? "common.enabled" : "common.disabled",
                    )}
                  </Tag>
                ),
              },
            ]}
          />
          {isRecentAuthenticationRequired(mutation.error) ? (
            <ReauthenticationAlert />
          ) : null}
          {editingSelf ? (
            <Alert
              type="warning"
              showIcon
              title={t("users.access.selfWarning")}
              description={t("users.access.selfWarningDetail")}
            />
          ) : null}
          <div>
            <Typography.Title level={5}>
              {t("users.access.choosePermissions")}
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              {t("users.access.choosePermissionsHint")}
            </Typography.Paragraph>
            <PermissionTable
              value={draft}
              disabled={mutation.isPending}
              onChange={setDraft}
            />
          </div>
        </Space>
      )}
    </Modal>
  );
}
