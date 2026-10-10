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

export function useSelectedRegion(initial?: string | null) {
  return useRegionSelection(regionStore, initial);
}

export function RegionField({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string | undefined;
  onChange: (tenantId: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <RegionPicker
      id="region"
      regions={regionTable.regions}
      value={value}
      onChange={onChange}
      disabled={disabled}
      autoFocus={autoFocus}
      translations={translations}
    />
  );
}
