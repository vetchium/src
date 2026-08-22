import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  normalizeSetDisplayNameRequest,
  type SetDisplayNameRequest,
} from "../../../typespec/admin/users/profile.ts";
import { isDisplayName } from "../../../typespec/common/localization.ts";
import { setDisplayName } from "../features/profile/api";
import { myInfoQueryKey, useMyInfoQuery } from "../features/profile/queries";

interface DisplayNameForm extends SetDisplayNameRequest {}
export function ProfilePage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const nameMutation = useMutation({ mutationFn: setDisplayName });
  const [form] = Form.useForm<DisplayNameForm>();
  if (me === undefined) return null;

  const saved = async () => {
    await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
    void message.success(t("profile.saved"));
  };

  const saveFailed = () => {
    void message.error(t("profile.saveError"));
  };

  const saveName = async (values: DisplayNameForm) => {
    try {
      const normalized = normalizeSetDisplayNameRequest(values);
      await nameMutation.mutateAsync(normalized);
      form.setFieldsValue(normalized);
      await saved();
    } catch {
      saveFailed();
    }
  };

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <div>
        <Typography.Title level={1}>{t("profile.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("profile.description")}
        </Typography.Text>
      </div>
      <Card title={t("profile.nameCard")}>
        <Form<DisplayNameForm>
          form={form}
          layout="vertical"
          initialValues={{
            display_name: me.display_name,
          }}
          onFinish={(values) => void saveName(values)}
        >
          <Form.Item
            name="display_name"
            label={t("fields.name")}
            extra={t("profile.nameHint")}
            rules={[
              { required: true, message: t("validation.required") },
              {
                validator: (_: unknown, value: string | undefined) =>
                  value === undefined || value === "" || isDisplayName(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.displayName"))),
              },
            ]}
          >
            <Input autoComplete="name" maxLength={200} />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={nameMutation.isPending}
          >
            {t("common.save")}
          </Button>
        </Form>
      </Card>
    </Space>
  );
}
