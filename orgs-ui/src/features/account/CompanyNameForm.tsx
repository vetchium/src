import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input } from "antd";
import { useTranslation } from "react-i18next";
import { isDisplayName } from "typespec/common/localization";
import type { SetCompanyNameRequest } from "typespec/orgs/settings/company";
import { orgsAPI } from "../../api/orgs";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey } from "./queries";
export function CompanyNameForm({ name }: { name: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: orgsAPI.setCompanyName,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("company.saved"));
    },
  });
  return (
    <Form<SetCompanyNameRequest>
      layout="vertical"
      initialValues={{ display_name: name }}
      onFinish={(values) => mutation.mutate(values)}
    >
      <Form.Item
        name="display_name"
        label={t("company.name")}
        rules={[
          {
            validator: (_, value: unknown) =>
              typeof value === "string" && isDisplayName(value)
                ? Promise.resolve()
                : Promise.reject(new Error(t("company.invalidName"))),
          },
        ]}
      >
        <Input autoComplete="organization" disabled={mutation.isPending} />
      </Form.Item>
      <APIErrorAlert error={mutation.error} />
      <Button htmlType="submit" type="primary" loading={mutation.isPending}>
        {t("common.save")}
      </Button>
    </Form>
  );
}
