import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Flex, Tooltip, Typography, theme } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * A field's label with help behind an icon. The button is outside the label
 * so that it joins neither the field's accessible name nor a click on the
 * label, and so that keyboards reach it, unlike `Form.Item tooltip`.
 */
export function FieldLabel({
  htmlFor,
  label,
  help,
  optional = false,
}: {
  /** Omit for read-only content: a label renames whatever button it names. */
  htmlFor?: string;
  label: string;
  help?: string;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  return (
    <Flex
      align="center"
      gap={2}
      wrap
      style={{ minHeight: 30, paddingBottom: token.paddingXXS }}
    >
      {htmlFor === undefined ? (
        <span>{label}</span>
      ) : (
        <label htmlFor={htmlFor}>{label}</label>
      )}
      {help === undefined ? null : (
        <Tooltip
          title={help}
          open={open}
          onOpenChange={setOpen}
          trigger={["hover", "focus"]}
        >
          <Button
            type="text"
            size="small"
            shape="circle"
            aria-label={t("common.about", { field: label })}
            // A click trigger would close what hover or focus just opened.
            onClick={() => setOpen(true)}
            icon={
              <Typography.Text type="secondary">
                <QuestionCircleOutlined />
              </Typography.Text>
            }
          />
        </Tooltip>
      )}
      {optional ? (
        <Typography.Text type="secondary">
          {t("common.optional")}
        </Typography.Text>
      ) : null}
    </Flex>
  );
}
