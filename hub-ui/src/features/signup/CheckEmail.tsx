import { MailOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Typography, theme } from "antd";
import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";

/** Replaces the signup form once a request was accepted. It never says
 * whether the address could be used. */
export function CheckEmail({
  email,
  region,
  resending,
  resent,
  error,
  onResend,
  onDifferentEmail,
}: {
  email: string;
  region: string;
  resending: boolean;
  resent: boolean;
  error: unknown;
  onResend: () => void;
  onDifferentEmail: () => void;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <Flex vertical gap="middle">
      <MailOutlined
        aria-hidden
        style={{
          alignSelf: "flex-start",
          fontSize: token.fontSizeHeading2,
          color: token.colorPrimary,
        }}
      />
      <Typography.Title
        ref={heading}
        tabIndex={-1}
        level={1}
        style={{ margin: 0, outline: "none" }}
      >
        {t("signup.sentTitle")}
      </Typography.Title>
      <Typography.Text style={{ overflowWrap: "anywhere" }}>
        <Trans
          i18nKey="signup.sentBody"
          values={{ email }}
          components={{ strong: <strong /> }}
        />
      </Typography.Text>
      <Typography.Text type="secondary">
        {t("signup.accountRegion", { region })}
      </Typography.Text>
      {resent ? (
        <Alert type="success" showIcon title={t("signup.resent")} />
      ) : null}
      <APIErrorAlert error={error} />
      <Flex gap="small" wrap>
        <Button loading={resending} onClick={onResend}>
          {t("signup.resend")}
        </Button>
        <Button type="link" disabled={resending} onClick={onDifferentEmail}>
          {t("signup.differentEmail")}
        </Button>
      </Flex>
      <Link to="/login">{t("common.backToSignin")}</Link>
    </Flex>
  );
}
