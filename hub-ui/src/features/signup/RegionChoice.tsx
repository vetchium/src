import { EnvironmentOutlined } from "@ant-design/icons";
import type { PortalRegion } from "@vetchium/portal-ui/regions";
import { Button, Flex, Select, Typography, theme } from "antd";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../app/PreferencesContext";
import { FieldLabel } from "../../components/common/FieldLabel";
import { regionName } from "../regions/names";

/** The account region signup filled in from the country: a summary, or a
 * picker once the visitor asks to change it. */
export function RegionChoice({
  options,
  selected,
  recommended,
  choosing,
  onChangeRequested,
  onSelect,
  disabled,
}: {
  options: readonly PortalRegion[];
  selected: PortalRegion;
  recommended: PortalRegion | undefined;
  choosing: boolean;
  onChangeRequested: () => void;
  onSelect: (tenantId: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { language } = usePreferences();
  const id = useId();
  const label = t("signup.regionLabel");
  const help = t("signup.regionHelp");

  if (choosing) {
    return (
      <div>
        <FieldLabel htmlFor={id} label={label} help={help} />
        <Select
          id={id}
          autoFocus
          className="full-width"
          disabled={disabled}
          value={selected.tenantId}
          onChange={onSelect}
          options={options.map((region) => {
            const name = regionName(t, region, language);
            return {
              value: region.tenantId,
              label:
                region.tenantId === recommended?.tenantId
                  ? t("signup.recommendedRegion", { region: name })
                  : name,
            };
          })}
        />
      </div>
    );
  }
  return (
    <Flex
      align="center"
      gap="small"
      style={{
        padding: `${token.paddingXS}px ${token.paddingSM}px`,
        borderRadius: token.borderRadius,
        background: token.colorFillQuaternary,
      }}
    >
      <EnvironmentOutlined aria-hidden style={{ color: token.colorPrimary }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <FieldLabel label={label} help={help} />
        <Typography.Text strong data-testid="signup-region">
          {regionName(t, selected, language)}
        </Typography.Text>
      </div>
      {options.length > 1 ? (
        <Button
          type="link"
          disabled={disabled}
          aria-label={t("signup.changeRegionLabel")}
          onClick={onChangeRequested}
        >
          {t("signup.change")}
        </Button>
      ) : null}
    </Flex>
  );
}
