import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import type { ReauthenticateRequest } from "typespec/admin/auth/login";
import { validateReauthenticateRequest } from "typespec/admin/auth/login";
import { safeReturnTo } from "../auth/navigation";
import { reauthenticate } from "../features/auth/api";
import {
  type MyInfoQueryData,
  myInfoQueryKey,
  useMyInfoQuery,
} from "../features/profile/queries";

export function ReauthenticatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const mutation = useMutation({ mutationFn: reauthenticate });
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  if (me === undefined) return null;

  const submit = async (request: ReauthenticateRequest) => {
    if (validateReauthenticateRequest(request).length !== 0) return;
    let response: Awaited<ReturnType<typeof reauthenticate>>;
    try {
      response = await mutation.mutateAsync(request);
    } catch {
      return;
    }
    if (!mounted.current) return;

    queryClient.setQueryData<MyInfoQueryData>(myInfoQueryKey, (current) =>
      current === undefined
        ? current
        : {
            ...current,
            session_authenticated_at: response.session_authenticated_at,
          },
    );
    navigate(returnTo, { replace: true });
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
            <Button
              block
              disabled={mutation.isPending}
              onClick={() => navigate("/", { replace: true })}
            >
              {t("reauthentication.cancel")}
            </Button>
          </Space>
        </Form>
      </Space>
    </Card>
  );
}
