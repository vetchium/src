import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ReauthenticationAlert } from "@vetchium/portal-ui/shell";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Flex,
  Radio,
  Space,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  directPermissions,
  type OrgPermissionID,
  Superadmin,
} from "typespec/orgs/authorization/types";
import type { OrgUserSummary } from "typespec/orgs/users/management";
import { isRecentAuthenticationRequired } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../../components/common/useDateTimeFormat";
import { PermissionTable } from "./PermissionTable";
import { userSummaryQueryKey, usersQueryKey } from "./queries";
import {
  mayChange,
  mayGrant,
  presetGrants,
  type Role,
  roleOf,
  rolePresets,
} from "./roles";

interface MemberDrawerProps {
  user: OrgUserSummary | null;
  viewerEmail: string;
  viewerPermissions: readonly OrgPermissionID[];
  onClose: () => void;
}

/** The catalog checkboxes stay authoritative: presets only pre-tick them. */
export function MemberDrawer({
  user,
  viewerEmail,
  viewerPermissions,
  onClose,
}: MemberDrawerProps) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const formatDateTime = useDateTimeFormat();
  const self = user?.email_address === viewerEmail;
  const [custom, setCustom] = useState(
    user !== null && roleOf(user.granted_permissions) === "custom",
  );
  const queryClient = useQueryClient();
  // Seeded once for the user this drawer was mounted for, so a list refresh
  // cannot overwrite unsaved edits. The caller remounts it per target.
  const [draft, setDraft] = useState<OrgPermissionID[]>(
    user?.granted_permissions ?? [],
  );
  const mutation = useMutation({ mutationFn: orgsAPI.setUserPermissions });
  const stateMutation = useMutation({
    mutationFn: (enable: boolean) => {
      if (user === null) throw new Error("Missing member");
      return enable
        ? orgsAPI.enableUser({ email_address: user.email_address })
        : orgsAPI.disableUser({ email_address: user.email_address });
    },
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
      void queryClient.invalidateQueries({ queryKey: userSummaryQueryKey });
    },
  });
  const stateLocked =
    self ||
    (!viewerPermissions.includes(Superadmin) &&
      user?.granted_permissions.includes(Superadmin));
  const busy = mutation.isPending || stateMutation.isPending;

  const save = async () => {
    if (
      user === null ||
      busy ||
      self ||
      !mayChange(viewerPermissions, user.granted_permissions, draft)
    )
      return;
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
      title={t("people.member")}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Flex justify="flex-end" gap="small">
          <Button disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="primary"
            loading={mutation.isPending}
            disabled={
              busy ||
              unchanged ||
              self ||
              !mayChange(
                viewerPermissions,
                user?.granted_permissions ?? [],
                draft,
              )
            }
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
          <Descriptions
            column={1}
            items={[
              {
                key: "state",
                label: t("users.columns.state"),
                children: t(
                  `users.state.${user.state === "active" ? "active" : "disabled-manual"}`,
                ),
              },
              {
                key: "joined",
                label: t("users.columns.joined"),
                children: formatDateTime(user.joined_at),
              },
              {
                key: "last",
                label: t("users.columns.lastSignIn"),
                children:
                  user.last_login_at === undefined
                    ? t("users.never")
                    : formatDateTime(user.last_login_at),
              },
            ]}
          />
          {self ? <Alert type="info" title={t("people.self")} /> : null}
          <Radio.Group
            aria-label={t("users.role")}
            value={custom ? "custom" : roleOf(draft)}
            disabled={self || busy}
            onChange={(event) => {
              const role = event.target.value as Role;
              setCustom(role === "custom");
              if (role !== "custom") setDraft(presetGrants(role));
            }}
            options={[
              ...rolePresets.map(({ preset, grants }) => ({
                value: preset,
                label: t(`roles.${preset}`),
                disabled: !mayChange(
                  viewerPermissions,
                  user.granted_permissions,
                  grants,
                ),
              })),
              { value: "custom", label: t("roles.custom") },
            ]}
          />
          {viewerPermissions.includes(Superadmin) ? null : (
            <Typography.Text type="secondary">
              {t("people.restricted")}
            </Typography.Text>
          )}
          <Typography.Paragraph type="secondary">
            {t("users.custom.hint")}
          </Typography.Paragraph>
          {isRecentAuthenticationRequired(mutation.error) ? (
            <ReauthenticationAlert />
          ) : (
            <APIErrorAlert error={mutation.error} />
          )}
          {custom ? (
            <PermissionTable
              value={draft}
              disabled={self || busy}
              locked={(permission) =>
                !mayGrant(viewerPermissions, [permission])
              }
              onChange={setDraft}
            />
          ) : null}
          <APIErrorAlert error={stateMutation.error} />
          <Button
            danger={user.state === "active"}
            disabled={stateLocked || busy}
            onClick={() => {
              const enable = user.state !== "active";
              modal.confirm({
                title: t(
                  enable ? "users.enable.confirm" : "users.disable.confirm",
                  { count: 1 },
                ),
                content: t(
                  enable ? "users.enable.effect" : "users.disable.effect",
                ),
                okText: t(
                  enable ? "users.enable.action" : "users.disable.action",
                ),
                okButtonProps: { danger: !enable },
                onOk: () => stateMutation.mutateAsync(enable).catch(() => {}),
              });
            }}
          >
            {t(
              user.state === "active"
                ? "users.disable.action"
                : "users.enable.action",
            )}
          </Button>
        </Space>
      )}
    </Drawer>
  );
}
