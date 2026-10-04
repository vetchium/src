import { useMutation, useQueryClient } from "@tanstack/react-query";
import { safeReturnTo } from "@vetchium/portal-ui/navigation";
import { Button, Card, Flex, Form, Input, Typography } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import type { MyInfoResponse } from "typespec/orgs/account/account";
import type { ReauthenticateRequest } from "typespec/orgs/auth/login";
import { validateReauthenticateRequest } from "typespec/orgs/auth/login";
import { orgsAPI } from "../api/orgs";
import { paths } from "../app/paths";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { myInfoQueryKey, useMyInfoQuery } from "../features/account/queries";

export function ReauthenticatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const mutation = useMutation({ mutationFn: orgsAPI.reauthenticate });
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
    try {
      const response = await mutation.mutateAsync(request);
      // The step-up guard reads this timestamp, so without it the guard
      // would send the user straight back here.
      queryClient.setQueryData<MyInfoResponse>(myInfoQueryKey, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              session_authenticated_at: response.session_authenticated_at,
            },
      );
    } catch {
      return;
    }
    if (mounted.current) navigate(returnTo, { replace: true });
  };

  return (
    <Card className="auth-card">
      <title>{t("reauthentication.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <div>
          <Typography.Title level={1}>
            {t("reauthentication.pageTitle")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("reauthentication.pageDescription")}
          </Typography.Text>
        </div>
        <Typography.Text>
          {t("reauthentication.account", {
            email: me.email_address,
            domain: me.org.domain.domain,
          })}
        </Typography.Text>
        <APIErrorAlert error={mutation.error} />
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
          <Flex orientation="vertical" gap="small">
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
              onClick={() => navigate(paths.home, { replace: true })}
            >
              {t("common.cancel")}
            </Button>
          </Flex>
        </Form>
      </Flex>
    </Card>
  );
}
