import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import type { ReauthenticateRequest } from "typespec/hub/auth/login";
import { hubAPI } from "../api/hub";
import { safeReturnTo } from "../auth/navigation";
import {
  type MyInfoQueryData,
  myInfoQueryKey,
  useMyInfoQuery,
} from "../features/profile/queries";

export function ReauthenticatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const returnTo = safeReturnTo(search.get("returnTo"));
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const mutation = useMutation({ mutationFn: hubAPI.reauthenticate });
  if (me === undefined) return null;

  const submit = async (request: ReauthenticateRequest) => {
    try {
      const response = await mutation.mutateAsync(request);
      queryClient.setQueryData<MyInfoQueryData>(myInfoQueryKey, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              session_authenticated_at: response.session_authenticated_at,
            },
      );
      navigate(returnTo, { replace: true });
    } catch {}
  };
  return (
    <Card className="auth-card">
      <title>{t("reauthentication.documentTitle")}</title>
      <Space orientation="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={1}>
            {t("reauthentication.pageTitle")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("reauthentication.pageDescription")}
          </Typography.Text>
        </div>
        <Typography.Text>
          {t("reauthentication.account", { email: me.email_address })}
        </Typography.Text>
        {mutation.isError ? (
          <Alert type="error" title={t("reauthentication.error")} />
        ) : null}
        <Form<ReauthenticateRequest>
          layout="vertical"
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            name="password"
            label={t("fields.password")}
            rules={[{ required: true, message: t("validation.required") }]}
          >
            <Input.Password autoFocus autoComplete="current-password" />
          </Form.Item>
          <Space orientation="vertical" className="full-width">
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={mutation.isPending}
            >
              {t("reauthentication.confirm")}
            </Button>
            <Button block onClick={() => navigate("/", { replace: true })}>
              {t("common.cancel")}
            </Button>
          </Space>
        </Form>
      </Space>
    </Card>
  );
}
