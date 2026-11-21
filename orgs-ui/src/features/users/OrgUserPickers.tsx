import { AutoComplete, Select } from "antd";
import { useState } from "react";
import { useTypedQuery } from "../../components/common/useTypedQuery";
import { useOrgUserSuggestionsQuery } from "./queries";

/**
 * The Org's active users matching the text typed: any part of an address,
 * those starting with the text first. Each picker searches on its own and
 * loads once first focused.
 */
function useOrgUserSuggestions() {
  const [query, setQuery, typed] = useTypedQuery();
  const [active, setActive] = useState(false);
  const suggestions = useOrgUserSuggestionsQuery(query, active);
  return {
    users: suggestions.data?.users ?? [],
    loading: suggestions.isFetching,
    typed,
    setQuery,
    activate: () => setActive(true),
  };
}

interface UserInputProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
}

/** One colleague's address: typed freely, with matching users offered. */
export function OrgUserInput({ id, value, onChange }: UserInputProps) {
  const { users, setQuery, activate } = useOrgUserSuggestions();
  return (
    <AutoComplete
      id={id}
      value={value}
      onChange={(next: string) => onChange?.(next)}
      onFocus={activate}
      options={users.map((email) => ({ value: email, label: email }))}
      showSearch={{ filterOption: false, onSearch: setQuery }}
      allowClear
    />
  );
}

interface UsersSelectProps {
  id?: string;
  value?: string[];
  onChange?: (value: string[]) => void;
  /** Offered before the Org's other users, filtered by the text typed. */
  preferred?: readonly string[];
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * Colleagues' addresses: each picked from the matching users or typed in
 * full.
 */
export function OrgUsersSelect({
  id,
  value,
  onChange,
  preferred = [],
  placeholder,
  "aria-label": ariaLabel,
}: UsersSelectProps) {
  const { users, loading, typed, setQuery, activate } = useOrgUserSuggestions();
  const needle = typed.trim().toLowerCase();
  const options = [
    ...new Set([
      ...preferred.filter((email) => email.includes(needle)),
      ...users,
      ...(needle === "" ? (value ?? []) : []),
    ]),
  ].map((email) => ({ value: email, label: email }));
  return (
    <Select
      id={id}
      mode="tags"
      value={value}
      onChange={(next: string[]) => onChange?.(next)}
      onFocus={activate}
      // Picking a suggestion clears the typed text without a search event.
      onSelect={() => setQuery("")}
      onBlur={() => setQuery("")}
      options={options}
      loading={loading}
      tokenSeparators={[",", " "]}
      showSearch={{ filterOption: false, onSearch: setQuery }}
      {...(placeholder !== undefined && { placeholder })}
      {...(ariaLabel !== undefined && { "aria-label": ariaLabel })}
    />
  );
}
