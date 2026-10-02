import { UserAddOutlined } from "@ant-design/icons";
import { Button, Flex, Space, Tabs, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMyInfoQuery } from "../features/account/queries";
import { defaultFilters, type MemberFilters } from "../features/users/filters";
import { InvitationsTab } from "../features/users/InvitationsTab";
import { InviteUsersModal } from "../features/users/InviteUsersModal";
import { MembersTab } from "../features/users/MembersTab";
import { UserSummaryStrip } from "../features/users/UserSummaryStrip";

export function MembersPage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const [filters, setFilters] = useState<MemberFilters>(defaultFilters);
  const [tab, setTab] = useState("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  if (me === undefined) return null;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("users.documentTitle")}</title>
      <Flex align="flex-start" justify="space-between" gap="middle" wrap>
        <div>
          <Typography.Title level={1}>{t("users.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("users.description")}
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<UserAddOutlined />}
          onClick={() => setInviteOpen(true)}
        >
          {t("users.invite.open")}
        </Button>
      </Flex>
      <UserSummaryStrip
        onRole={(role) => {
          setTab("members");
          setFilters({ ...defaultFilters, role });
        }}
        onState={(state) => {
          setTab("members");
          setFilters({ ...defaultFilters, state });
        }}
      />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "members",
            label: t("users.tabs.members"),
            children: (
              <MembersTab
                viewerEmail={me.email_address}
                viewerPermissions={me.permissions}
                filters={filters}
                onFilters={setFilters}
              />
            ),
          },
          {
            key: "invitations",
            label: t("users.tabs.invitations"),
            children: <InvitationsTab />,
          },
        ]}
      />
      <InviteUsersModal
        open={inviteOpen}
        viewerPermissions={me.permissions}
        onClose={() => setInviteOpen(false)}
      />
    </Space>
  );
}
