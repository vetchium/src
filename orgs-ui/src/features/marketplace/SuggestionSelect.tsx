import { matchingSuggestions } from "@vetchium/portal-ui/suggestions";
import { Select, Spin } from "antd";
import { useRef, useState } from "react";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import type { OpeningSuggestion } from "typespec/orgs/marketplace/contacts/contacts";
import { useTypedQuery } from "../../components/common/useTypedQuery";
import {
  useClientSuggestionsQuery,
  useJobOwnerSuggestionsQuery,
  useJobsQuery,
} from "./queries";

interface PickerProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder: string;
  ariaLabel: string;
  notFound: string;
  style?: React.CSSProperties;
}

interface Suggestion {
  value: string;
  label: string;
  /** What the API's search matches in it. */
  texts: readonly string[];
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
  const search = useTypedQuery();
  const [query] = search;
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
    texts: [client.display_name, client.domain],
  }));
  return (
    <SuggestionSelect
      {...props}
      options={options}
      fetching={suggestions.isFetching}
      onOpenChange={setOpen}
      search={search}
    />
  );
}

/**
 * Picks an agency user who may own a Job, by address, asking the API as the
 * user types.
 */
export function JobOwnerPicker(props: PickerProps) {
  const search = useTypedQuery();
  const [query] = search;
  const [open, setOpen] = useState(false);
  const suggestions = useJobOwnerSuggestionsQuery(
    query === undefined ? {} : { query },
    open,
  );
  const options = (suggestions.data?.owners ?? []).map((email) => ({
    value: email,
    label: email,
    texts: [email],
  }));
  return (
    <SuggestionSelect
      {...props}
      options={options}
      fetching={suggestions.isFetching}
      onOpenChange={setOpen}
      search={search}
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
  const search = useTypedQuery();
  const [query] = search;
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
    texts: [job.opening.title, String(job.opening.number)],
  }));
  return (
    <SuggestionSelect
      {...props}
      options={options}
      fetching={jobs.isFetching}
      onOpenChange={setOpen}
      search={search}
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
  fetching,
  onOpenChange,
  search,
}: PickerProps & {
  options: Suggestion[];
  fetching: boolean;
  onOpenChange: (open: boolean) => void;
  search: ReturnType<typeof useTypedQuery>;
}) {
  const [, setQuery, typed, settling] = search;
  const loading = fetching || settling;
  // A later search may not list the one chosen; keep its label shown.
  const seen = useRef(new Map<string, string>());
  for (const option of options) seen.current.set(option.value, option.label);
  const shown = matchingSuggestions(
    options,
    typed,
    (option) => option.texts,
  ).map((option) => ({ value: option.value, label: option.label }));
  // Only while nothing is typed: first in the list, Enter would pick it.
  if (
    value !== undefined &&
    typed.trim() === "" &&
    !shown.some((option) => option.value === value)
  ) {
    shown.unshift({ value, label: seen.current.get(value) ?? value });
  }
  return (
    <Select<string>
      allowClear
      value={value}
      onChange={(next) => onChange(next ?? undefined)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      // Picking a suggestion clears the typed text without a search event.
      onSelect={() => setQuery("")}
      options={shown}
      loading={loading}
      notFoundContent={loading ? <Spin size="small" /> : notFound}
      onOpenChange={onOpenChange}
      showSearch={{ filterOption: false, onSearch: setQuery }}
      popupMatchSelectWidth={false}
      style={{ minWidth: 220, ...style }}
    />
  );
}
