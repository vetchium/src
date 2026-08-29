import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Form, Input, Modal } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { AdminPermissionID } from "typespec/admin/authorization/types";
import { ViewUsers } from "typespec/admin/authorization/types";
import type { InviteUserRequest } from "typespec/admin/users/invitations";
import {
  normalizeInviteUserRequest,
  validateInviteUserRequest,
} from "typespec/admin/users/invitations";
import {
  AdminInvitationAlreadyPendingError,
  AdminUserAlreadyExistsError,
} from "typespec/problem/admin/users";
import { useIdempotencyKey } from "../../api/idempotency";
import { problemTranslationKey } from "../../api/problems";
import { intlLocale } from "../../app/preferences";
import { PermissionTable } from "../authorization/PermissionTable";
import { permissionGrants } from "../authorization/permissions";
import { inviteUser } from "./api";
import { usersQueryKey } from "./queries";

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
}

interface InviteFormValues {
  email_address: string;
  permissions: AdminPermissionID[];
}

const inviteProblems = {
  [AdminUserAlreadyExistsError.type]: "users.invite.errors.alreadyExists",
  [AdminInvitationAlreadyPendingError.type]:
    "users.invite.errors.alreadyPending",
};

export function InviteUserModal({ open, onClose }: InviteUserModalProps) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<InviteFormValues>();
  const invitationKey = useIdempotencyKey();
  const mutation = useMutation({
    mutationFn: (request: InviteUserRequest) =>
      inviteUser(request, invitationKey.current()),
  });

  // The modal is only hidden between openings, so the form store, the last
  // failure and the key would otherwise still belong to the previous
  // invitation. Reopening starts a new operation: keeping the key would send
  // the next invitation under it and earn an idempotency-key conflict. A retry
  // made without leaving the modal still reuses the key.
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (open) {
      form.resetFields();
      resetMutation();
      invitationKey.rotate();
    }
  }, [open, form, resetMutation, invitationKey]);

  const submit = async (values: InviteFormValues) => {
    const request = normalizeInviteUserRequest({
      email_address: values.email_address,
      permissions: permissionGrants(values.permissions),
    });
    try {
      const response = await mutation.mutateAsync(request);
      // Closing happens before anything else is awaited: isPending has already
      // gone false, so a further await would leave a window in which this
      // continuation could close a reopening it does not belong to.
      invitationKey.rotate();
      onClose();
      void message.success(
        t("users.invite.sent", {
          email: request.email_address,
          expiresAt: new Intl.DateTimeFormat(intlLocale(i18n.language), {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(response.expires_at)),
        }),
      );
    } catch (error) {
      void message.error(t(problemTranslationKey(error, inviteProblems)));
    } finally {
      // Also on failure, for the same reason: an invitation that commits and
      // loses its response still changed the server's state.
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    }
  };

  return (
    <Modal
      open={open}
      destroyOnHidden
      title={t("users.invite.title")}
      okText={t("users.invite.action")}
      cancelText={t("common.cancel")}
      confirmLoading={mutation.isPending}
      // Closing mid-flight would let the settled request close, and report on,
      // whichever invitation the modal has been reopened for since. Escape
      // reaches onCancel independently of the other three, so the handler
      // itself is the guard that has to hold.
      closable={!mutation.isPending}
      keyboard={!mutation.isPending}
      mask={{ closable: !mutation.isPending }}
      cancelButtonProps={{ disabled: mutation.isPending }}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!mutation.isPending) {
          onClose();
        }
      }}
    >
      <Form<InviteFormValues>
        form={form}
        layout="vertical"
        initialValues={{ permissions: [ViewUsers] }}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="email_address"
          label={t("fields.email")}
          rules={[
            { required: true, message: t("validation.required") },
            {
              validator: (_, value: string | undefined) =>
                value === undefined ||
                value === "" ||
                validateInviteUserRequest({ email_address: value }).length === 0
                  ? Promise.resolve()
                  : Promise.reject(new Error(t("validation.email"))),
            },
          ]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="permissions"
          label={t("users.invite.permissions")}
          extra={t("users.invite.permissionsHint")}
        >
          <PermissionTable disabled={mutation.isPending} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
