import { Input, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const minLength = 2;

interface Props {
  value: string | undefined;
  onSearch: (value: string | undefined) => void;
}

/** Name search; the API takes at least two characters, so shorter ones are
 * refused here with the reason beside the field. */
export function NameSearch({ value, onSearch }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState(value ?? "");
  const [tooShort, setTooShort] = useState(false);
  return (
    <div>
      <Input.Search
        className="toolbar-search"
        aria-label={t("applications.search")}
        placeholder={t("applications.search")}
        value={text}
        allowClear
        onChange={(event) => {
          setText(event.target.value);
          setTooShort(false);
          if (event.target.value === "") onSearch(undefined);
        }}
        onSearch={(entered) => {
          const trimmed = entered.trim();
          if (trimmed === "") {
            setTooShort(false);
            onSearch(undefined);
          } else if ([...trimmed].length < minLength) {
            setTooShort(true);
          } else {
            setTooShort(false);
            onSearch(trimmed);
          }
        }}
      />
      {tooShort && (
        <Typography.Text type="danger" role="alert">
          {t("applications.searchTooShort", { count: minLength })}
        </Typography.Text>
      )}
    </div>
  );
}
