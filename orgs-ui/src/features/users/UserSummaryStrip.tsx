import { Alert, Button, Card, Flex, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  ManageBilling,
  ManageUsers,
  Superadmin,
} from "typespec/orgs/authorization/types";
import type { UserStateFilter } from "typespec/orgs/users/management";
import { useUserSummaryQuery } from "./queries";
import type { RolePreset } from "./roles";

interface UserSummaryStripProps {
  onRole: (role: RolePreset) => void;
  onState: (state: UserStateFilter) => void;
}

/** Seats and member counts; every count applies its filter to the list. */
export function UserSummaryStrip({ onRole, onState }: UserSummaryStripProps) {
  const { t } = useTranslation();
  const query = useUserSummaryQuery();
  if (query.isPending) return <Spin />;
  if (query.isError) {
    return <Alert type="error" title={t("common.loadError")} />;
  }
  const summary = query.data;
  const count = (permission: string) =>
    summary.permission_counts.find((entry) => entry.permission === permission)
      ?.users ?? 0;
  const roles: Array<[RolePreset, number]> = [
    ["superadmin", count(Superadmin)],
    ["finance", count(ManageBilling)],
    ["userManager", count(ManageUsers)],
    ["member", summary.active_users_without_permissions],
  ];
  const states: Array<[UserStateFilter, number]> = [
    ["active", summary.active_users],
    ["disabled-manual", summary.disabled_manual_users],
    ["disabled-nonpayment", summary.disabled_nonpayment_users],
  ];
  return (
    <Card size="small">
      <Flex orientation="vertical" gap="small">
        <Typography.Text strong data-testid="user-seats">
          {summary.seat_limit === undefined
            ? t("users.summary.seatsUnlimited", {
                used: summary.seats_in_use,
              })
            : t("users.summary.seats", {
                used: summary.seats_in_use,
                limit: summary.seat_limit,
              })}
        </Typography.Text>
        <Flex gap="small" wrap align="center">
          <Typography.Text type="secondary">
            {t("users.summary.roles")}
          </Typography.Text>
          {roles.map(([role, users]) => (
            <Button
              key={role}
              size="small"
              type="link"
              data-testid={`summary-role-${role}`}
              onClick={() => onRole(role)}
            >
              {t(`users.summary.role.${role}`, { count: users })}
            </Button>
          ))}
        </Flex>
        <Flex gap="small" wrap align="center">
          <Typography.Text type="secondary">
            {t("users.summary.states")}
          </Typography.Text>
          {states.map(([state, users]) => (
            <Button
              key={state}
              size="small"
              type="link"
              data-testid={`summary-state-${state}`}
              onClick={() => onState(state)}
            >
              {t(`users.summary.state.${state}`, { count: users })}
            </Button>
          ))}
        </Flex>
      </Flex>
    </Card>
  );
}
