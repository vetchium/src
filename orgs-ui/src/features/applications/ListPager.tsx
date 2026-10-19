import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Flex } from "antd";
import { useTranslation } from "react-i18next";

interface Props {
  hasPrevious: boolean;
  hasNext: boolean;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function ListPager({
  hasPrevious,
  hasNext,
  busy,
  onPrevious,
  onNext,
}: Props) {
  const { t } = useTranslation();
  return (
    <Flex justify="end" gap="small">
      <Button
        icon={<LeftOutlined aria-hidden />}
        disabled={!hasPrevious || busy}
        onClick={onPrevious}
      >
        {t("common.previous")}
      </Button>
      <Button
        icon={<RightOutlined aria-hidden />}
        iconPlacement="end"
        disabled={!hasNext || busy}
        onClick={onNext}
      >
        {t("common.next")}
      </Button>
    </Flex>
  );
}
