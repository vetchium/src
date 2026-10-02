import { Form, Select } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { createRegionStore } from "./region-selection.ts";
import type { PortalRegion } from "./regions.ts";

/**
 * The region selected on a page, remembered in `store` on change. `initial`,
 * such as a validated `region` link parameter, pre-selects without being
 * remembered until the user signs in or changes it. The page passes the
 * selection to every request it makes; nothing else reads it.
 */
export function useRegionSelection(
  store: ReturnType<typeof createRegionStore>,
  initial?: string | null,
) {
  const [tenantId, setTenantId] = useState(() => initial ?? store.read());
  const select = (value: string) => {
    store.remember(value);
    setTenantId(value);
  };
  return [tenantId, select] as const;
}

/** Sign-in requires a fresh choice, independent of saved preferences or links. */
export function useExplicitRegionSelection() {
  return useState<string | undefined>();
}

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
  value: string | undefined;
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
        aria-required="true"
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
