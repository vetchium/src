import { DownloadOutlined } from "@ant-design/icons";
import { App, Button } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaginationKey } from "typespec/common/pagination";
import { orgsAPI } from "../../api/orgs";
import { downloadCSV, toCSV } from "./csv";
import { filtersToRequest, type MemberFilters } from "./filters";
import { roleOf } from "./roles";

/** Builds the file in the browser by paging the member list, so there is no
 * export endpoint and no server-side file. */
export function ExportButton({ filters }: { filters: MemberFilters }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [exported, setExported] = useState<number | null>(null);

  const run = async () => {
    setExported(0);
    const rows: string[][] = [
      [
        t("fields.email"),
        t("users.role"),
        t("fields.permissions"),
        t("users.columns.state"),
        t("users.columns.joined"),
        t("users.columns.lastSignIn"),
      ],
    ];
    try {
      let key: PaginationKey | undefined;
      do {
        const page = await orgsAPI.listUsers({
          ...filtersToRequest(filters),
          limit: 100,
          ...(key === undefined ? {} : { pagination_key: key }),
        });
        for (const user of page.users) {
          rows.push([
            user.email_address,
            t(`roles.${roleOf(user.granted_permissions)}`),
            user.granted_permissions.join(" "),
            user.disabled_reason === undefined
              ? user.state
              : `${user.state}-${user.disabled_reason}`,
            user.joined_at,
            user.last_login_at ?? "",
          ]);
        }
        setExported(rows.length - 1);
        key = page.next_pagination_key;
      } while (key !== undefined);
      downloadCSV("members.csv", toCSV(rows));
    } catch {
      void message.error(t("users.export.failed"));
    } finally {
      setExported(null);
    }
  };

  return (
    <Button
      icon={<DownloadOutlined />}
      loading={exported !== null}
      onClick={() => void run()}
    >
      {exported === null
        ? t("users.export.action")
        : t("users.export.progress", { count: exported })}
    </Button>
  );
}
