import { Button, Flex, Tag } from "antd";
import { useTranslation } from "react-i18next";

/** What every setup step is given. */
export interface StepProps {
  /** Moves on; `done` says whether this step now holds what it asks for. */
  onAdvance: (done: boolean) => void;
  /** Absent when no other step needs anything. */
  onSkip: (() => void) | undefined;
  onDirtyChange: (dirty: boolean) => void;
}

export function StepActions({
  label,
  onContinue,
  onSkip,
  pending = false,
  dirty = false,
}: {
  label?: string;
  /** Absent when there is nothing to continue with yet. */
  onContinue?: () => void;
  onSkip?: () => void;
  pending?: boolean;
  dirty?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Flex gap="small" align="center" wrap>
      {onContinue === undefined ? null : (
        <Button type="primary" loading={pending} onClick={onContinue}>
          {label}
        </Button>
      )}
      {onSkip === undefined || pending ? null : (
        <Button
          type={onContinue === undefined ? "default" : "text"}
          onClick={onSkip}
        >
          {t("setup.skip")}
        </Button>
      )}
      {dirty ? <Tag color="warning">{t("setup.unsaved")}</Tag> : null}
    </Flex>
  );
}
