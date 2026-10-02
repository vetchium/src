import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ReauthenticationAlert } from "@vetchium/portal-ui/shell";
import { App, Button, Drawer, Flex, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  directPermissions,
  type OrgPermissionID,
} from "typespec/orgs/authorization/types";
import type { OrgUserSummary } from "typespec/orgs/users/management";
import { isRecentAuthenticationRequired } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { PermissionTable } from "./PermissionTable";
import { userSummaryQueryKey, usersQueryKey } from "./queries";
import { mayGrant } from "./roles";

interface CustomRoleDrawerProps {
  user: OrgUserSummary | null;
  viewerPermissions: readonly OrgPermissionID[];
  onClose: () => void;
}

/** The catalog checkboxes stay authoritative: presets only pre-tick them. */
export function CustomRoleDrawer({
  user,
  viewerPermissions,
  onClose,
}: CustomRoleDrawerProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // Seeded once for the user this drawer was mounted for, so a list refresh
  // cannot overwrite unsaved edits. The caller remounts it per target.
  const [draft, setDraft] = useState<OrgPermissionID[]>(
    user?.granted_permissions ?? [],
  );
  const mutation = useMutation({ mutationFn: orgsAPI.setUserPermissions });

  const save = async () => {
    if (user === null || mutation.isPending) return;
    try {
      await mutation.mutateAsync({
        email_address: user.email_address,
        permissions: directPermissions(draft),
      });
      onClose();
      void message.success(t("users.roleChange.saved"));
    } catch {
      return;
    } finally {
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
      void queryClient.invalidateQueries({ queryKey: userSummaryQueryKey });
    }
  };

  const unchanged =
    user !== null &&
    JSON.stringify([...directPermissions(draft)].sort()) ===
      JSON.stringify([...directPermissions(user.granted_permissions)].sort());

  return (
    <Drawer
      open={user !== null}
      destroyOnHidden
      size={560}
      title={t("users.custom.title")}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      footer={
        <Flex justify="flex-end" gap="small">
          <Button disabled={mutation.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="primary"
            loading={mutation.isPending}
            disabled={unchanged}
            onClick={() => void save()}
          >
            {t("common.save")}
          </Button>
        </Flex>
      }
    >
      {user === null ? null : (
        <Space orientation="vertical" size="large" className="full-width">
          <Typography.Text strong>{user.email_address}</Typography.Text>
          <Typography.Paragraph type="secondary">
            {t("users.custom.hint")}
          </Typography.Paragraph>
          {isRecentAuthenticationRequired(mutation.error) ? (
            <ReauthenticationAlert />
          ) : (
            <APIErrorAlert error={mutation.error} />
          )}
          <PermissionTable
            value={draft}
            disabled={mutation.isPending}
            locked={(permission) => !mayGrant(viewerPermissions, [permission])}
            onChange={setDraft}
          />
        </Space>
      )}
    </Drawer>
  );
}
