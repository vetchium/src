import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Descriptions, Modal, Radio, Space, Tag, Typography } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ManageUsers,
  ViewUsers,
} from "../../../../typespec/admin/authorization/types.ts";
import type { AdminUserSummary } from "../../../../typespec/admin/users/management.ts";
import { AdminUserNotFoundError } from "../../../../typespec/problem/admin/users.ts";
import { isRecentAuthenticationRequired } from "../../api/client";
import { problemTranslationKey } from "../../api/problems";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";
import { usersQueryKey } from "../users/queries";
import { setPermissions } from "./api";

type AccessLevel = "manager" | "viewer" | "none";

interface UserAccessModalProps {
  user: AdminUserSummary | null;
  onClose: () => void;
}

const accessProblems = {
  [AdminUserNotFoundError.type]: "users.errors.notFound",
};

function accessLevel(user: AdminUserSummary): AccessLevel {
  if (user.permissions.includes(ManageUsers)) return "manager";
  if (user.permissions.includes(ViewUsers)) return "viewer";
  return "none";
}

export function UserAccessModal({ user, onClose }: UserAccessModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: setPermissions });
  const targetID = user?.admin_user_id ?? null;
  const resetMutation = mutation.reset;

  useEffect(() => {
    if (targetID !== null) resetMutation();
  }, [targetID, resetMutation]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    void queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
  };

  const setAccess = async (level: AccessLevel) => {
    if (user === null || mutation.isPending) return;
    const permissions =
      level === "manager"
        ? [ManageUsers]
        : level === "viewer"
          ? [ViewUsers]
          : [];
    try {
      await mutation.mutateAsync({
        admin_user_id: user.admin_user_id,
        permissions,
      });
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

  return (
    <Modal
      open={user !== null}
      destroyOnHidden
      title={t("users.access.title")}
      okText={t("common.close")}
      footer={(_, { OkBtn }) => <OkBtn />}
      closable={!mutation.isPending}
      keyboard={!mutation.isPending}
      mask={{ closable: !mutation.isPending }}
      okButtonProps={{ disabled: mutation.isPending }}
      onOk={() => {
        if (!mutation.isPending) onClose();
      }}
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
          <div>
            <Typography.Title level={5}>
              {t("users.access.chooseLevel")}
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              {t("users.access.chooseLevelHint")}
            </Typography.Paragraph>
            <Radio.Group
              className="access-level-options"
              value={accessLevel(user)}
              disabled={mutation.isPending}
              onChange={(event) => void setAccess(event.target.value)}
              options={[
                {
                  value: "manager",
                  label: (
                    <span>
                      <Typography.Text strong>
                        {t("users.access.levels.manager.title")}
                      </Typography.Text>
                      <br />
                      <Typography.Text type="secondary">
                        {t("users.access.levels.manager.description")}
                      </Typography.Text>
                    </span>
                  ),
                },
                {
                  value: "viewer",
                  label: (
                    <span>
                      <Typography.Text strong>
                        {t("users.access.levels.viewer.title")}
                      </Typography.Text>
                      <br />
                      <Typography.Text type="secondary">
                        {t("users.access.levels.viewer.description")}
                      </Typography.Text>
                    </span>
                  ),
                },
                {
                  value: "none",
                  label: (
                    <span>
                      <Typography.Text strong>
                        {t("users.access.levels.none.title")}
                      </Typography.Text>
                      <br />
                      <Typography.Text type="secondary">
                        {t("users.access.levels.none.description")}
                      </Typography.Text>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </Space>
      )}
    </Modal>
  );
}
