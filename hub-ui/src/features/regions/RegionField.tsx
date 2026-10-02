import { RegionPicker } from "@vetchium/portal-ui/region-picker";
import { useState } from "react";
import { regionStore, regionTable } from "../../app/regions";

const translations = {
  label: "region.label",
  help: "region.help",
  option: "region.option",
} as const;

/** The selected sign-in region, remembered for this browser on change. */
export function useSelectedRegion() {
  const [tenantId, setTenantId] = useState(regionStore.read);
  const select = (value: string) => {
    regionStore.remember(value);
    setTenantId(value);
  };
  return [tenantId, select] as const;
}

export function RegionField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (tenantId: string) => void;
  disabled?: boolean;
}) {
  return (
    <RegionPicker
      id="region"
      regions={regionTable.regions}
      value={value}
      onChange={onChange}
      disabled={disabled}
      translations={translations}
    />
  );
}
