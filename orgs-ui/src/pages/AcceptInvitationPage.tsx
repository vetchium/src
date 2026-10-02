import { useMutation, useQuery } from "@tanstack/react-query";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import { regionFromSearchParams } from "@vetchium/portal-ui/region-selection";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  Spin,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { isNewPassword, isOpaqueToken } from "typespec/common/authentication";
import { InvitationInvalidError } from "typespec/problem/orgs/users";
import { getProblemType, isDefiniteRefusal } from "../api/client";
import { orgsAPI } from "../api/orgs";
import { loginPath, paths } from "../app/paths";
import { readPreferredLanguage } from "../app/preferences";
import { regionStore, regionTable } from "../app/regions";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../components/common/useDateTimeFormat";

interface AcceptValues {
  new_password: string;
  confirm_password: string;
}

export function AcceptInvitationPage() {
  const { t } = useTranslation();
  const formatDateTime = useDateTimeFormat();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const region = regionFromSearchParams(regionTable, search);
  const usable = isOpaqueToken(token) && region !== null;
  // Persisted per link so that a retry after a lost response replays the
  // acceptance rather than failing on a token the first attempt consumed.
  const key = useIdempotencyKey(`orgs-accept-invitation:${token}`);
  const { hold } = usePendingOperations();
  const details = useQuery({
    queryKey: ["orgs", "invitation-details", token, region],
    queryFn: () =>
      orgsAPI.getInvitationDetails({ invitation_token: token }, region ?? ""),
    enabled: usable,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: async (values: AcceptValues) => {
      const release = hold();
      try {
        return await orgsAPI.acceptInvitation(
          {
            invitation_token: token,
            password: values.new_password,
            preferred_language: readPreferredLanguage(),
          },
          key.current(),
          region ?? "",
        );
      } finally {
        release();
      }
    },
    onSuccess: () => {
      key.rotate();
      if (region !== null) regionStore.remember(region);
    },
    onError: (error) => {
      if (isDefiniteRefusal(error)) key.rotate();
    },
  });
  const invalid =
    getProblemType(details.error) === InvitationInvalidError.type ||
    getProblemType(accept.error) === InvitationInvalidError.type;

  return (
    <Card className="auth-card">
      <title>{t("acceptInvitation.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <Typography.Title level={1}>
          {t("acceptInvitation.title")}
        </Typography.Title>
        {!usable ? (
          <Alert
            type="error"
            showIcon
            title={t("acceptInvitation.missingToken")}
          />
        ) : invalid ? (
          <Alert type="error" showIcon title={t("errors.invalidInvitation")} />
        ) : accept.isSuccess ? (
          <>
            <div data-testid="accept-invitation-done">
              <Alert
                type="success"
                showIcon
                title={t("acceptInvitation.success")}
              />
            </div>
            <Link to={loginPath(accept.data.domain)}>
              {t("common.continueToSignIn")}
            </Link>
          </>
        ) : details.isPending ? (
          <Spin />
        ) : details.isError ? (
          <APIErrorAlert error={details.error} />
        ) : (
          <>
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: "domain",
                  label: t("fields.domain"),
                  children: (
                    <span data-testid="invitation-domain">
                      {details.data.domain}
                    </span>
                  ),
                },
                {
                  key: "email",
                  label: t("fields.email"),
                  children: (
                    <span data-testid="invitation-email">
                      {details.data.email_address}
                    </span>
                  ),
                },
                {
                  key: "expires",
                  label: t("acceptInvitation.expires"),
                  children: formatDateTime(details.data.expires_at),
                },
              ]}
            />
            <APIErrorAlert error={accept.error} />
            <Form<AcceptValues>
              layout="vertical"
              onFinish={(values) => accept.mutate(values)}
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
                      isNewPassword(value)
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(t("validation.newPassword")),
                          ),
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
                    validator: (_, value: string | undefined) =>
                      value === undefined ||
                      value === "" ||
                      value === getFieldValue("new_password")
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(t("validation.passwordMatch")),
                          ),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" maxLength={128} />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={accept.isPending}
              >
                {t("acceptInvitation.action")}
              </Button>
            </Form>
            <Link to={paths.login}>{t("common.backToSignIn")}</Link>
          </>
        )}
      </Flex>
    </Card>
  );
}
