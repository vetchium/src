import { Button, Card, Flex, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useHref, useLinkClickHandler } from "react-router";
import { useMyApplicationCountsQuery } from "../applications/queries";

const awaitingPath = "/applications?awaiting=1";

export function ApplicationsBanner() {
  const { t } = useTranslation();
  const href = useHref(awaitingPath);
  const open = useLinkClickHandler<HTMLAnchorElement>(awaitingPath);
  const count = useMyApplicationCountsQuery().data?.awaiting_answer ?? 0;
  if (count === 0) return null;
  return (
    <Card size="small">
      <Flex justify="space-between" align="center" wrap gap="small">
        <Flex gap="small" align="center" wrap>
          <Tag color="processing">{t("home.needsYou")}</Tag>
          <Typography.Text strong>
            {t("home.applicationsBody", { count })}
          </Typography.Text>
        </Flex>
        <Button
          type="primary"
          href={href}
          onClick={(event) =>
            open(event as React.MouseEvent<HTMLAnchorElement>)
          }
        >
          {t("home.applicationsAction")}
        </Button>
      </Flex>
    </Card>
  );
}
