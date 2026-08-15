import { useMutation } from "@tanstack/react-query";
import { App, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { validateChangePasswordRequest } from "../../../../typespec/admin/auth/password.ts";
import type { NewPassword } from "../../../../typespec/common/authentication.ts";
import { isRecentAuthenticationRequired } from "../../api/client";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { changePassword } from "./api";

interface ChangePasswordForm {
  new_password: NewPassword;
  confirm_password: string;
}

export function ChangePasswordCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<ChangePasswordForm>();
  const mutation = useMutation({ mutationFn: changePassword });

  const submit = async ({ new_password }: ChangePasswordForm) => {
    try {
      await mutation.mutateAsync({ new_password });
      form.resetFields();
      void message.success(t("security.password.changed"));
    } catch (error) {
      if (!isRecentAuthenticationRequired(error)) {
        void message.error(t("common.requestError"));
      }
    }
  };

  return (
    <Card title={t("security.password.card")}>
      <Space orientation="vertical" size="middle" className="full-width">
        <Typography.Text type="secondary">
          {t("security.password.description")}
        </Typography.Text>
        {isRecentAuthenticationRequired(mutation.error) ? (
          <ReauthenticationAlert />
        ) : null}
        <Form<ChangePasswordForm>
          form={form}
          layout="vertical"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="new_password"
            label={t("fields.newPassword")}
            rules={[
              { required: true, message: t("validation.required") },
              {
                validator: (_, value: string | undefined) =>
                  value === undefined ||
                  value === "" ||
                  validateChangePasswordRequest({ new_password: value })
                    .length === 0
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.newPassword"))),
              },
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={128} />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label={t("fields.confirmPassword")}
            dependencies={["new_password"]}
            rules={[
              { required: true, message: t("validation.required") },
              ({ getFieldValue }) => ({
                validator: (_, value: string) =>
                  value === getFieldValue("new_password")
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.passwordMatch"))),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={128} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            {t("security.password.action")}
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
