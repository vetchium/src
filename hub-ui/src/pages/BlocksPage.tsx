import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { App, Button, Card, Flex, List, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { HubHandle } from "typespec/hub/types";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import {
  useBlockActionMutation,
  useBlockedUsersQuery,
  useMutedUsersQuery,
} from "../features/blocks/queries";

interface Row {
  handle: HubHandle;
  created_at: string;
}

function UserSection({
  kind,
  query,
}: {
  kind: "blocked" | "muted";
  query: UseInfiniteQueryResult<{ pages: { users: Row[] }[] }>;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const undo = useBlockActionMutation(
    kind === "blocked" ? "unblock" : "unmute",
  );
  const users = query.data?.pages.flatMap((page) => page.users) ?? [];
  return (
    <Card title={t(`blocks.${kind}Title`)}>
      <Space orientation="vertical" className="full-width">
        <Typography.Text type="secondary">
          {t(`blocks.${kind}Help`)}
        </Typography.Text>
        {query.isError ? <APIErrorAlert error={query.error} /> : null}
        <APIErrorAlert error={undo.error} />
        <List
          loading={query.isPending}
          dataSource={users}
          rowKey={(user) => user.handle}
          locale={{ emptyText: t(`blocks.${kind}Empty`) }}
          renderItem={(user) => (
            <List.Item
              actions={[
                <Button
                  key="undo"
                  size="small"
                  loading={undo.isPending && undo.variables === user.handle}
                  disabled={undo.isPending}
                  aria-label={t(`blocks.${kind}Undo`, { handle: user.handle })}
                  onClick={() =>
                    undo.mutate(user.handle, {
                      onSuccess: () =>
                        void message.success(
                          t(`blocks.${kind}UndoDone`, { handle: user.handle }),
                        ),
                    })
                  }
                >
                  {t(`blocks.${kind}UndoLabel`)}
                </Button>,
              ]}
            >
              <Link to={`/u/${user.handle}`}>@{user.handle}</Link>
            </List.Item>
          )}
          loadMore={
            query.hasNextPage ? (
              <Flex justify="center">
                <Button
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t("blocks.more")}
                </Button>
              </Flex>
            ) : null
          }
        />
      </Space>
    </Card>
  );
}

export function BlocksPage() {
  const { t } = useTranslation();
  const blocked = useBlockedUsersQuery();
  const muted = useMutedUsersQuery();
  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("blocks.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("blocks.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("blocks.description")}
        </Typography.Text>
      </div>
      <UserSection kind="blocked" query={blocked} />
      <UserSection kind="muted" query={muted} />
    </Space>
  );
}
