import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { SetDisplayNamesRequest } from "../../../typespec/admin/users/profile.ts";
import type { LocalizedDisplayName } from "../../../typespec/common/localization.ts";
import { setDisplayNames } from "../features/profile/api";
import { myInfoQueryKey, useMyInfoQuery } from "../features/profile/queries";

interface DisplayNamesForm extends SetDisplayNamesRequest {}
export function ProfilePage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const namesMutation = useMutation({ mutationFn: setDisplayNames });
  if (me === undefined) return null;

  const saved = async () => {
    await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
    void message.success(t("profile.saved"));
  };

  const saveFailed = () => {
    void message.error(t("profile.saveError"));
  };

  const saveNames = async (values: DisplayNamesForm) => {
    try {
      await namesMutation.mutateAsync(values);
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
      <Card title={t("profile.namesCard")}>
        <Form<DisplayNamesForm>
          layout="vertical"
          initialValues={{
            display_names: me.display_names,
            primary_display_name_language: me.primary_display_name_language,
          }}
          onFinish={(values) => void saveNames(values)}
        >
          <Form.List name="display_names">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" className="full-width">
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap>
                    <Form.Item
                      {...field}
                      name={[field.name, "language_code"]}
                      label={t("fields.languageCode")}
                      rules={[
                        {
                          required: true,
                          pattern: /^[a-z]{2}-[A-Z]{2}$/,
                          message: t("validation.languageCode"),
                        },
                      ]}
                    >
                      <Input
                        placeholder={t("profile.languageCodePlaceholder")}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "display_name"]}
                      label={t("fields.displayName")}
                      rules={[
                        { required: true, message: t("validation.required") },
                      ]}
                    >
                      <Input maxLength={200} />
                    </Form.Item>
                    <Button
                      disabled={fields.length === 1}
                      onClick={() => remove(field.name)}
                    >
                      {t("common.remove")}
                    </Button>
                  </Space>
                ))}
                <Button
                  onClick={() =>
                    add({
                      language_code: "",
                      display_name: "",
                    } satisfies LocalizedDisplayName)
                  }
                >
                  {t("profile.addName")}
                </Button>
              </Space>
            )}
          </Form.List>
          <Form.Item
            name="primary_display_name_language"
            label={t("profile.primaryLanguage")}
            rules={[{ required: true, message: t("validation.required") }]}
          >
            <Input placeholder={t("profile.languageCodePlaceholder")} />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={namesMutation.isPending}
          >
            {t("common.save")}
          </Button>
        </Form>
      </Card>
    </Space>
  );
}
