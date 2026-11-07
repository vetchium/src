import { Select } from "antd";
import { useEffect, useRef, useState } from "react";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { OpeningSuggestion } from "typespec/orgs/marketplace/contacts/contacts";
import {
  useClientSuggestionsQuery,
  useJobOwnerSuggestionsQuery,
  useJobsQuery,
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

/** The picker value of an Opening: its client's domain and its number. */
export function openingKey(opening: OpeningSuggestion): string {
  return `${opening.consumer_domain}::${opening.opening_number}`;
}

export function openingFromKey(
  key: string | undefined,
): OpeningSuggestion | undefined {
  const [domain, number] = key?.split("::") ?? [];
  if (domain === undefined || number === undefined) return undefined;
  return { consumer_domain: domain, opening_number: Number(number) };
}

/**
 * Picks one of the agency's `published` Jobs by title or Opening number,
 * asking the API as the user types. The value is `openingKey`.
 */
export function JobPicker(props: PickerProps) {
  const [query, setQuery] = useTypedQuery();
  const [open, setOpen] = useState(false);
  const jobs = useJobsQuery(
    {
      state: "published",
      limit: 20,
      ...(query !== undefined && { search: query }),
    },
    open,
  );
  const options = (jobs.data?.jobs ?? []).map((job) => ({
    value: openingKey({
      consumer_domain: job.client.domain,
      opening_number: job.opening.number,
    }),
    label: `${job.opening.title} (${job.client.display_name || job.client.domain})`,
  }));
  // A later search may not list the chosen Job; keep its label shown.
  const seen = useRef(new Map<string, string>());
  for (const option of options) seen.current.set(option.value, option.label);
  if (
    props.value !== undefined &&
    !options.some((option) => option.value === props.value)
  ) {
    options.unshift({
      value: props.value,
      label: seen.current.get(props.value) ?? props.value,
    });
  }
  return (
    <SuggestionSelect
      {...props}
      options={options}
      loading={jobs.isFetching}
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
