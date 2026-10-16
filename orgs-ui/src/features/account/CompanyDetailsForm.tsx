import { useMutation, useQueryClient } from "@tanstack/react-query";
import { frontendLocaleOptions } from "@vetchium/portal-ui/localization";
import { App, Button, Form, Input, Select } from "antd";
import { useTranslation } from "react-i18next";
import { isDisplayName } from "typespec/common/localization";
import type { OrgSummary } from "typespec/orgs/account/account";
import {
  normalizeSetCompanyDetailsRequest,
  type SetCompanyDetailsRequest,
} from "typespec/orgs/settings/company";
import { orgsAPI } from "../../api/orgs";
import { frontendLocaleValues } from "../../app/preferences";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { countryOptions } from "./countryOptions";
import { myInfoQueryKey } from "./queries";

export function CompanyDetailsForm({ org }: { org: OrgSummary }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: orgsAPI.setCompanyDetails,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("company.saved"));
    },
  });
  return (
    <Form<SetCompanyDetailsRequest>
      layout="vertical"
      initialValues={{
        display_name: org.display_name,
        country: org.country,
        default_language: org.default_language,
      }}
      disabled={mutation.isPending}
      onFinish={(values) =>
        mutation.mutate(normalizeSetCompanyDetailsRequest(values))
      }
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
        <Input autoComplete="organization" />
      </Form.Item>
      <Form.Item
        name="country"
        label={t("company.country")}
        extra={t("company.countryHelp")}
        rules={[{ required: true, message: t("validation.required") }]}
      >
        <Select
          showSearch
          optionFilterProp="label"
          options={countryOptions(i18n.language)}
        />
      </Form.Item>
      <Form.Item
        name="default_language"
        label={t("company.defaultLanguage")}
        extra={t("company.defaultLanguageHelp")}
        rules={[{ required: true, message: t("validation.required") }]}
      >
        <Select options={frontendLocaleOptions(frontendLocaleValues)} />
      </Form.Item>
      <APIErrorAlert error={mutation.error} />
      <Button htmlType="submit" type="primary" loading={mutation.isPending}>
        {t("common.save")}
      </Button>
    </Form>
  );
}
