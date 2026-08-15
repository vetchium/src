import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Descriptions,
  Flex,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { AdminPermission } from "../../../../typespec/admin/authorization/types.ts";
import {
  ManageUsers,
  ViewUsers,
} from "../../../../typespec/admin/authorization/types.ts";
import type { AdminUserSummary } from "../../../../typespec/admin/users/management.ts";
import {
  CannotDemoteCurrentSuperadminError,
  PermissionDependencyConflictError,
  PermissionNotApplicableError,
  SuperadminRequiredError,
} from "../../../../typespec/problem/admin/authorization.ts";
import {
  AdminUserNotFoundError,
  LastActiveSuperadminError,
} from "../../../../typespec/problem/admin/users.ts";
import { isRecentAuthenticationRequired } from "../../api/client";
import { problemTranslationKey } from "../../api/problems";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";
import { usersQueryKey } from "../users/queries";
import {
  demoteFromSuperadmin,
  grantPermission,
  promoteToSuperadmin,
  revokePermission,
} from "./api";

interface UserAccessModalProps {
  user: AdminUserSummary | null;
  onClose: () => void;
}

const managedPermissions: AdminPermission[] = [ViewUsers, ManageUsers];

const accessProblems = {
  [AdminUserNotFoundError.type]: "users.errors.notFound",
  [PermissionNotApplicableError.type]: "users.access.errors.notApplicable",
  [PermissionDependencyConflictError.type]:
    "users.access.errors.dependencyConflict",
  [CannotDemoteCurrentSuperadminError.type]:
    "users.access.errors.cannotDemoteSelf",
  [LastActiveSuperadminError.type]: "users.errors.lastSuperadmin",
  [SuperadminRequiredError.type]: "users.errors.superadminRequired",
};

export function UserAccessModal({ user, onClose }: UserAccessModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const permissionMutation = useMutation({
    mutationFn: ({
      permission,
      granted,
      adminUserID,
    }: {
      permission: AdminPermission;
      granted: boolean;
      adminUserID: string;
    }) =>
      granted
        ? grantPermission({ admin_user_id: adminUserID, permission })
        : revokePermission({ admin_user_id: adminUserID, permission }),
  });
  const superadminMutation = useMutation({
    mutationFn: ({
      promoted,
      adminUserID,
    }: {
      promoted: boolean;
      adminUserID: string;
    }) =>
      promoted
        ? promoteToSuperadmin({ admin_user_id: adminUserID })
        : demoteFromSuperadmin({ admin_user_id: adminUserID }),
  });

  // Promotion clears the direct permissions, so the two mutations can undo one
  // another if they overlap, and closing mid-flight would let the settled
  // request report against whichever administrator the modal has been reopened
  // for since. One flag closes both races.
  const busy = permissionMutation.isPending || superadminMutation.isPending;

  // The modal outlives the row it was opened from, so a failure recorded for
  // one administrator must not surface while another one is being edited.
  const targetID = user?.admin_user_id ?? null;
  const resetPermissionMutation = permissionMutation.reset;
  const resetSuperadminMutation = superadminMutation.reset;
  useEffect(() => {
    if (targetID === null) return;
    resetPermissionMutation();
    resetSuperadminMutation();
  }, [targetID, resetPermissionMutation, resetSuperadminMutation]);

  // Reconciled after every attempt, not only after a success: a mutation that
  // commits and then loses its response would otherwise leave the switches
  // showing the access the administrator no longer has, and a retry of a
  // promotion or demotion repeats its side effects on permissions and sessions.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
  };

  const reportFailure = (error: unknown) => {
    if (!isRecentAuthenticationRequired(error)) {
      void message.error(t(problemTranslationKey(error, accessProblems)));
    }
  };

  // Only promote and demote sit behind the step-up middleware today, but
  // reportFailure suppresses the toast for either mutation, so both must be
  // able to raise the alert that replaces it.
  const stepUpRequired = [
    superadminMutation.error,
    permissionMutation.error,
  ].some(isRecentAuthenticationRequired);

  const setPermission = async (
    permission: AdminPermission,
    granted: boolean,
  ) => {
    if (user === null || busy) return;
    try {
      await permissionMutation.mutateAsync({
        permission,
        granted,
        adminUserID: user.admin_user_id,
      });
      void message.success(
        t(granted ? "users.access.granted" : "users.access.revoked"),
      );
    } catch (error) {
      reportFailure(error);
    } finally {
      refresh();
    }
  };

  const setSuperadmin = async (promoted: boolean) => {
    if (user === null || busy) return;
    try {
      await superadminMutation.mutateAsync({
        promoted,
        adminUserID: user.admin_user_id,
      });
      void message.success(
        t(promoted ? "users.access.promoted" : "users.access.demoted"),
      );
    } catch (error) {
      reportFailure(error);
    } finally {
      refresh();
    }
  };

  const displayName =
    user?.display_names.find(
      (name) => name.language_code === user.primary_display_name_language,
    )?.display_name ?? user?.email_address;

  return (
    <Modal
      open={user !== null}
      destroyOnHidden
      title={t("users.access.title")}
      okText={t("common.close")}
      footer={(_, { OkBtn }) => <OkBtn />}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      okButtonProps={{ disabled: busy }}
      onOk={() => {
        if (!busy) onClose();
      }}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {user === null ? null : (
        <Space orientation="vertical" size="middle" className="full-width">
          <Descriptions
            column={1}
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
                key: "state",
                label: t("fields.state"),
                children: (
                  <Tag color={user.state === "active" ? "green" : "default"}>
                    {t(`states.${user.state}`)}
                  </Tag>
                ),
              },
            ]}
          />
          {stepUpRequired ? <ReauthenticationAlert /> : null}
          <Flex align="center" justify="space-between" gap="middle">
            <div>
              <Typography.Text strong>{t("home.superadmin")}</Typography.Text>
              <br />
              <Typography.Text type="secondary">
                {t("users.access.superadminHint")}
              </Typography.Text>
            </div>
            <Switch
              checked={user.is_superadmin}
              disabled={busy}
              loading={superadminMutation.isPending}
              aria-label={t("home.superadmin")}
              onChange={(checked) => void setSuperadmin(checked)}
            />
          </Flex>
          <div>
            <Typography.Text strong>
              {t("users.access.permissions")}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary">
              {user.is_superadmin
                ? t("users.access.permissionsSuperadminHint")
                : t("users.access.permissionsHint")}
            </Typography.Text>
          </div>
          {managedPermissions.map((permission) => (
            <Flex
              key={permission}
              align="center"
              justify="space-between"
              gap="middle"
            >
              <Typography.Text>
                {t(`permissions.${permission}`)}
              </Typography.Text>
              <Switch
                checked={
                  user.is_superadmin || user.permissions.includes(permission)
                }
                disabled={user.is_superadmin || busy}
                loading={permissionMutation.isPending}
                aria-label={t(`permissions.${permission}`)}
                onChange={(checked) => void setPermission(permission, checked)}
              />
            </Flex>
          ))}
        </Space>
      )}
    </Modal>
  );
}
