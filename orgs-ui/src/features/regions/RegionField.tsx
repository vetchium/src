import {
  RegionPicker,
  useRegionSelection,
} from "@vetchium/portal-ui/region-picker";
import { regionStore, regionTable } from "../../app/regions";

const translations = {
  label: "region.label",
  help: "region.help",
  option: "region.option",
} as const;

export function useSelectedRegion() {
  return useRegionSelection(regionStore);
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
