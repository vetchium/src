import { Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";

export function OptionalLabel({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <Flex component="span" gap={4} wrap>
      <span>{label}</span>
      {/* Hidden from the field's name; aria-required already tells it. */}
      <Typography.Text type="secondary" aria-hidden>
        {t("common.optional")}
      </Typography.Text>
    </Flex>
  );
}
