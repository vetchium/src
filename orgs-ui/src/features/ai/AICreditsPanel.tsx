import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Flex,
  Row,
  Table,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaginationKey } from "typespec/common/pagination";
import type { AICreditsResponse } from "typespec/orgs/ai/ai";
import type { AICreditLot, AICreditPack } from "typespec/orgs/ai/types";
import { isDefiniteRefusal } from "../../api/client";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { SeePlansButton } from "./AIUpgrade";
import { formatPrice } from "./format";
import { useAICreditLotsQuery, useBuyAICreditPack } from "./queries";

const pageSize = 25;

export function AICreditsPanel({ credits }: { credits: AICreditsResponse }) {
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const { date } = useDateTimeFormat();
  const buy = useBuyAICreditPack();
  const key = useIdempotencyKey();
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const lots = useAICreditLotsQuery(pageSize, pageKeys[pageIndex]);
  const number = new Intl.NumberFormat(i18n.language);

  const purchase = (pack: AICreditPack) => {
    modal.confirm({
      title: t("ai.credits.buyTitle", {
        credits: number.format(pack.credits),
      }),
      content: t("ai.credits.buySimulated", {
        price: formatPrice(
          i18n.language,
          pack.price_currency,
          pack.price_amount_minor,
        ),
      }),
      okText: t("ai.credits.buy"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await buy.mutateAsync({
            request: { pack_id: pack.pack_id },
            key: key.current(),
          });
          key.rotate();
          setPageKeys([undefined]);
          setPageIndex(0);
          void message.success(t("ai.credits.bought"));
        } catch (cause) {
          if (isDefiniteRefusal(cause)) key.rotate();
          void message.error(problemMessage(t, cause));
        }
      },
    });
  };

  const next = () => {
    const nextKey = lots.data?.next_pagination_key;
    if (nextKey === undefined) return;
    setPageKeys((keys) => [...keys.slice(0, pageIndex + 1), nextKey]);
    setPageIndex((index) => index + 1);
  };

  return (
    <Flex vertical gap="large">
      <Card title={t("ai.credits.packsTitle")}>
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">
            {credits.monthly_grant > 0
              ? t("ai.credits.grantIncluded", {
                  credits: number.format(credits.monthly_grant),
                })
              : t("ai.credits.grantNotIncluded")}
          </Typography.Text>
          <Alert type="info" showIcon title={t("ai.credits.simulated")} />
          {!credits.purchase_allowed ? (
            <Alert
              type="warning"
              showIcon
              title={t("ai.credits.goldOnly")}
              action={<SeePlansButton small />}
            />
          ) : null}
          <Row gutter={[16, 16]}>
            {credits.packs.map((pack) => (
              <Col xs={24} md={12} key={pack.pack_id}>
                <Card size="small">
                  <Flex justify="space-between" align="center" gap="middle">
                    <Flex vertical>
                      <Typography.Text strong>
                        {t("ai.credits.packCredits", {
                          credits: number.format(pack.credits),
                        })}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {formatPrice(
                          i18n.language,
                          pack.price_currency,
                          pack.price_amount_minor,
                        )}
                      </Typography.Text>
                    </Flex>
                    <Button
                      onClick={() => purchase(pack)}
                      disabled={!credits.purchase_allowed}
                      loading={buy.isPending}
                    >
                      {t("ai.credits.buy")}
                    </Button>
                  </Flex>
                </Card>
              </Col>
            ))}
          </Row>
        </Flex>
      </Card>
      <Card title={t("ai.credits.lotsTitle")}>
        <Flex vertical gap="middle">
          {lots.isError ? (
            <Alert type="error" showIcon title={t("common.loadError")} />
          ) : null}
          <Table<AICreditLot>
            rowKey={(lot) => `${lot.created_at}-${lot.kind}-${lot.pack_id}`}
            dataSource={lots.data?.lots ?? []}
            loading={lots.isPending || lots.isFetching}
            pagination={false}
            scroll={{ x: 640 }}
            locale={{ emptyText: t("ai.credits.noLots") }}
            columns={[
              {
                title: t("ai.credits.kind"),
                render: (_, lot) => t(`ai.credits.kinds.${lot.kind}`),
              },
              {
                title: t("ai.credits.granted"),
                align: "end",
                render: (_, lot) => number.format(lot.credits_granted),
              },
              {
                title: t("ai.credits.remaining"),
                align: "end",
                render: (_, lot) => number.format(lot.credits_remaining),
              },
              {
                title: t("ai.credits.added"),
                render: (_, lot) => date(lot.created_at),
              },
              {
                title: t("ai.credits.expires"),
                render: (_, lot) => date(lot.expires_at),
              },
            ]}
          />
          <Flex justify="space-between" align="center">
            <Button
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((index) => index - 1)}
            >
              {t("common.previous")}
            </Button>
            <Button
              disabled={lots.data?.next_pagination_key === undefined}
              onClick={next}
            >
              {t("common.next")}
            </Button>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
