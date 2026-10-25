import { Select } from "antd";
import { useEffect, useState } from "react";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import {
  useClientSuggestionsQuery,
  useJobOwnerSuggestionsQuery,
} from "./queries";

const debounceMs = 250;

/** The trimmed text typed, once typing pauses; undefined while empty. */
function useTypedQuery(): [string | undefined, (value: string) => void] {
  const [typed, setTyped] = useState("");
  const [settled, setSettled] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = typed.trim();
      setSettled(trimmed === "" ? undefined : trimmed);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [typed]);
  return [settled, setTyped];
}

interface PickerProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder: string;
  ariaLabel: string;
  notFound: string;
  style?: React.CSSProperties;
}

/**
 * Picks one of the Org's clients by name or domain, asking the API as the
 * user types, so it works with thousands of clients. The value is the
 * client's domain.
 */
export function ClientPicker({
  capability,
  ...props
}: PickerProps & { capability?: Capability }) {
  const [query, setQuery] = useTypedQuery();
  const [open, setOpen] = useState(false);
  const suggestions = useClientSuggestionsQuery(
    {
      ...(capability !== undefined && { capability }),
      ...(query !== undefined && { query }),
    },
    open,
  );
  const options = (suggestions.data?.clients ?? []).map((client) => ({
    value: client.domain,
    label: `${client.display_name} (${client.domain})`,
  }));
  if (
    props.value !== undefined &&
    !options.some((option) => option.value === props.value)
  ) {
    options.unshift({ value: props.value, label: props.value });
  }
  return (
    <SuggestionSelect
      {...props}
      options={options}
      loading={suggestions.isFetching}
      onOpenChange={setOpen}
      onSearch={setQuery}
    />
  );
}

/**
 * Picks an agency user who may own a Job, by address, asking the API as the
 * user types.
 */
export function JobOwnerPicker(props: PickerProps) {
  const [query, setQuery] = useTypedQuery();
  const [open, setOpen] = useState(false);
  const suggestions = useJobOwnerSuggestionsQuery(
    query === undefined ? {} : { query },
    open,
  );
  const options = (suggestions.data?.owners ?? []).map((email) => ({
    value: email,
    label: email,
  }));
  if (
    props.value !== undefined &&
    !options.some((option) => option.value === props.value)
  ) {
    options.unshift({ value: props.value, label: props.value });
  }
  return (
    <SuggestionSelect
      {...props}
      options={options}
      loading={suggestions.isFetching}
      onOpenChange={setOpen}
      onSearch={setQuery}
    />
  );
}

function SuggestionSelect({
  value,
  onChange,
  placeholder,
  ariaLabel,
  notFound,
  style,
  options,
  loading,
  onOpenChange,
  onSearch,
}: PickerProps & {
  options: { value: string; label: string }[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (value: string) => void;
}) {
  return (
    <Select<string>
      allowClear
      value={value}
      onChange={(next) => onChange(next ?? undefined)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      options={options}
      loading={loading}
      notFoundContent={loading ? undefined : notFound}
      onOpenChange={onOpenChange}
      showSearch={{ filterOption: false, onSearch }}
      popupMatchSelectWidth={false}
      style={{ minWidth: 220, ...style }}
    />
  );
}
