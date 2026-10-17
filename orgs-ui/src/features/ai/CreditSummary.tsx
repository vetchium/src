import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Progress,
  Row,
  Typography,
  theme,
} from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AICreditsResponse } from "typespec/orgs/ai/ai";
import { type CreditUse, creditUse, overallCreditUse } from "./creditUse";

function CreditGauge({
  title,
  use,
  testID,
  details,
  empty,
}: {
  title: string;
  use: CreditUse | undefined;
  testID: string;
  details: ReactNode;
  empty: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { token } = theme.useToken();
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <Card size="small" title={title} className="ai-credit-card">
      {use === undefined ? (
        empty
      ) : (
        <Flex gap="large" align="center" wrap>
          <Progress
            type="dashboard"
            percent={use.percent}
            size={120}
            strokeColor={
              {
                normal: token.colorPrimary,
                warning: token.colorWarning,
                exhausted: token.colorError,
              }[use.level]
            }
            format={(percent) => (
              <Typography.Text
                strong
                type={
                  {
                    normal: undefined,
                    warning: "warning" as const,
                    exhausted: "danger" as const,
                  }[use.level]
                }
              >
                {percent === 0 && use.used > 0
                  ? t("ai.summary.underOnePercent")
                  : t("ai.summary.percentUsed", { percent })}
              </Typography.Text>
            )}
            aria-label={t("ai.summary.gaugeLabel", { title })}
            data-testid={testID}
          />
          <Flex vertical gap="small">
            <Typography.Text strong>
              {t("ai.summary.left", {
                left: number.format(use.left),
                total: number.format(use.total),
              })}
            </Typography.Text>
            {details}
          </Flex>
        </Flex>
      )}
    </Card>
  );
}

/** Both credit sources at a glance, with an alert when credits run low. */
export function CreditSummary({
  credits,
  onBuy,
}: {
  credits: AICreditsResponse;
  onBuy: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const number = new Intl.NumberFormat(i18n.language);
  const balance = credits.balance;
  const overall = overallCreditUse(balance);
  const buy = credits.purchase_allowed ? (
    <Button size="small" onClick={onBuy}>
      {t("ai.summary.buy")}
    </Button>
  ) : undefined;

  return (
    <Flex vertical gap="middle">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <CreditGauge
            title={t("ai.summary.monthlyTitle")}
            testID="ai-monthly-credits"
            use={creditUse(
              balance.monthly_grant_total,
              balance.monthly_grant_remaining,
            )}
            details={
              balance.monthly_grant_expires_at ? (
                <Typography.Text type="secondary">
                  {t("ai.summary.monthlyRenews", {
                    date: date(balance.monthly_grant_expires_at),
                  })}
                </Typography.Text>
              ) : null
            }
            empty={
              <Typography.Text type="secondary">
                {credits.monthly_grant > 0
                  ? t("ai.summary.monthlyPending", {
                      credits: number.format(credits.monthly_grant),
                    })
                  : t("ai.summary.monthlyNone")}
              </Typography.Text>
            }
          />
        </Col>
        <Col xs={24} md={12}>
          <CreditGauge
            title={t("ai.summary.purchasedTitle")}
            testID="ai-purchased-credits"
            use={creditUse(
              balance.purchased_total,
              balance.purchased_remaining,
            )}
            details={
              balance.purchased_next_expires_at ? (
                <Typography.Text type="secondary">
                  {t("ai.summary.purchasedExpires", {
                    date: date(balance.purchased_next_expires_at),
                  })}
                </Typography.Text>
              ) : null
            }
            empty={
              <Flex vertical gap="small" align="start">
                <Typography.Text type="secondary">
                  {t("ai.summary.purchasedNone")}
                </Typography.Text>
                {buy}
              </Flex>
            }
          />
        </Col>
      </Row>
      {overall === undefined || overall.level === "normal" ? null : (
        <Alert
          type={overall.level === "warning" ? "warning" : "error"}
          showIcon
          title={t(`ai.summary.${overall.level}`, {
            percent: overall.percent,
          })}
          action={buy}
        />
      )}
      {balance.reserved > 0 ? (
        <Typography.Text type="secondary">
          {t("ai.summary.reserved", {
            credits: number.format(balance.reserved),
          })}
        </Typography.Text>
      ) : null}
    </Flex>
  );
}
