import { Form, Select } from "antd";
import { useTranslation } from "react-i18next";
import type { PortalRegion } from "./regions.ts";

export interface RegionPickerTranslations {
  /** Field label. */
  label: string;
  /** Help text below the field, explaining that the account lives in one
   * region. */
  help: string;
  /** One option, interpolating `country` (the hosting country's localized
   * name) and `tenantId`. */
  option: string;
}

/**
 * The region chooser shown before credentials on a sign-in or signup page.
 * The caller passes the regions eligible on that page, so signup can offer a
 * narrower list than sign-in.
 */
export function RegionPicker({
  id,
  regions,
  value,
  onChange,
  disabled,
  translations,
}: {
  id: string;
  regions: readonly PortalRegion[];
  value: string;
  onChange: (tenantId: string) => void;
  disabled?: boolean;
  translations: RegionPickerTranslations;
}) {
  const { t, i18n } = useTranslation();
  const countries = new Intl.DisplayNames(
    [i18n.resolvedLanguage ?? i18n.language],
    { type: "region" },
  );
  return (
    <Form.Item
      label={t(translations.label)}
      htmlFor={id}
      help={t(translations.help)}
      required
    >
      <Select
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={regions.map((region) => ({
          value: region.tenantId,
          label: t(translations.option, {
            country:
              countries.of(region.hostingCountry) ?? region.hostingCountry,
            tenantId: region.tenantId,
          }),
        }))}
      />
    </Form.Item>
  );
}
