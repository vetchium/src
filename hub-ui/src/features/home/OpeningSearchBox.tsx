import { Input, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

/** Starts an Opening search; the search page applies every other filter. */
export function OpeningSearchBox({ size }: { size?: "large" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="full-width">
      <Input.Search
        aria-label={t("home.searchLabel")}
        placeholder={t("openingSearch.keywordPlaceholder")}
        enterButton={t("openingSearch.search")}
        size={size}
        status={invalid ? "error" : undefined}
        onChange={() => setInvalid(false)}
        onSearch={(value) => {
          const keyword = value.trim();
          const length = [...keyword].length;
          if (length === 1 || length > 200) {
            setInvalid(true);
            return;
          }
          navigate(
            length === 0
              ? "/openings"
              : `/openings?${new URLSearchParams({ q: keyword })}`,
          );
        }}
      />
      {invalid ? (
        <Typography.Text type="danger">
          {t("openingSearch.keywordLength")}
        </Typography.Text>
      ) : null}
    </div>
  );
}
