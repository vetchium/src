import { UploadOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Flex,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrgPermissionID } from "typespec/orgs/authorization/types";
import { directPermissions } from "typespec/orgs/authorization/types";
import type {
  InviteOutcome,
  InviteResult,
} from "typespec/orgs/users/invitations";
import { maxBulk } from "typespec/orgs/users/invitations";
import { isDefiniteRefusal } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { chunk, parseAddresses } from "./csv";
import { PermissionTable } from "./PermissionTable";
import { invitationsQueryKey, userSummaryQueryKey } from "./queries";
import {
  mayGrant,
  presetGrants,
  type RolePreset,
  roleOf,
  rolePresets,
} from "./roles";

interface InviteUsersModalProps {
  open: boolean;
  viewerPermissions: readonly OrgPermissionID[];
  onClose: () => void;
}

const outcomeColors: Record<InviteOutcome, string> = {
  invited: "green",
  "already-member": "default",
  "already-invited": "default",
  "domain-mismatch": "orange",
  invalid: "red",
};

export function InviteUsersModal({
  open,
  viewerPermissions,
  onClose,
}: InviteUsersModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [grants, setGrants] = useState<OrgPermissionID[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [results, setResults] = useState<InviteResult[]>([]);
  // One key per distinct request, kept until the server decides it, so a
  // retry after a lost response replays instead of inviting twice.
  const keys = useRef(new Map<string, string>());

  const addresses = parseAddresses(text);
  const done = results.length > 0 && error === null && !running;
  const preset = roleOf(grants);

  const reset = () => {
    setText("");
    setGrants([]);
    setResults([]);
    setError(null);
  };
  const close = () => {
    if (running) return;
    reset();
    onClose();
  };

  const submit = async () => {
    setRunning(true);
    setError(null);
    const direct = directPermissions(grants);
    const collected: InviteResult[] = [];
    try {
      for (const batch of chunk(addresses, maxBulk)) {
        const fingerprint = JSON.stringify([batch, direct]);
        const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
        keys.current.set(fingerprint, key);
        try {
          const response = await orgsAPI.inviteUsers(
            { email_addresses: batch, permissions: direct },
            key,
          );
          keys.current.delete(fingerprint);
          collected.push(...response.results);
          setResults([...collected]);
        } catch (failure) {
          if (isDefiniteRefusal(failure)) keys.current.delete(fingerprint);
          throw failure;
        }
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setRunning(false);
      void queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
      void queryClient.invalidateQueries({ queryKey: userSummaryQueryKey });
    }
  };

  const importFile = async (file: File) => {
    const imported = parseAddresses(await file.text());
    setText((current) =>
      parseAddresses([current, ...imported].join("\n")).join("\n"),
    );
    return false;
  };

  return (
    <Modal
      open={open}
      destroyOnHidden
      width={720}
      title={t("users.invite.title")}
      okText={done ? t("common.done") : t("users.invite.action")}
      cancelText={t("common.cancel")}
      confirmLoading={running}
      okButtonProps={{ disabled: !done && addresses.length === 0 }}
      cancelButtonProps={{ disabled: running, hidden: done }}
      closable={!running}
      keyboard={!running}
      mask={{ closable: !running }}
      onOk={() => (done ? close() : void submit())}
      onCancel={close}
    >
      <Space orientation="vertical" size="large" className="full-width">
        {results.length === 0 ? (
          <>
            <Flex orientation="vertical" gap="small">
              <Typography.Text strong id="invite-addresses-label">
                {t("users.invite.addresses")}
              </Typography.Text>
              <Input.TextArea
                aria-labelledby="invite-addresses-label"
                rows={5}
                value={text}
                disabled={running}
                onChange={(event) => setText(event.target.value)}
              />
              <Typography.Text type="secondary">
                {t("users.invite.addressesHelp")}
              </Typography.Text>
              <Flex gap="middle" align="center" wrap>
                <Upload
                  accept=".csv,.txt,text/csv,text/plain"
                  showUploadList={false}
                  beforeUpload={importFile}
                  disabled={running}
                >
                  <Button icon={<UploadOutlined />}>
                    {t("users.invite.chooseFile")}
                  </Button>
                </Upload>
                <Typography.Text
                  type="secondary"
                  data-testid="invite-address-count"
                >
                  {t("users.invite.count", { count: addresses.length })}
                </Typography.Text>
              </Flex>
              {addresses.length > maxBulk ? (
                <Typography.Text type="secondary">
                  {t("users.invite.batches", {
                    count: Math.ceil(addresses.length / maxBulk),
                  })}
                </Typography.Text>
              ) : null}
            </Flex>
            <Flex orientation="vertical" gap="small">
              <Typography.Text strong id="invite-role-label">
                {t("users.role")}
              </Typography.Text>
              <Radio.Group
                aria-labelledby="invite-role-label"
                value={preset}
                disabled={running}
                onChange={(event) => {
                  const next = event.target.value as RolePreset | "custom";
                  if (next !== "custom") setGrants(presetGrants(next));
                }}
                options={[
                  ...rolePresets.map(({ preset: value, grants: granted }) => ({
                    value,
                    label: t(`roles.${value}`),
                    disabled: !mayGrant(viewerPermissions, granted),
                  })),
                  { value: "custom", label: t("roles.custom"), disabled: true },
                ]}
              />
              <PermissionTable
                value={grants}
                disabled={running}
                locked={(permission) =>
                  !mayGrant(viewerPermissions, [permission])
                }
                onChange={setGrants}
              />
            </Flex>
          </>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              title={t("users.invite.results", {
                invited: results.filter((entry) => entry.outcome === "invited")
                  .length,
                total: results.length,
              })}
            />
            <Table<InviteResult>
              rowKey="email_address"
              size="small"
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              dataSource={results}
              columns={[
                {
                  title: t("fields.email"),
                  dataIndex: "email_address",
                },
                {
                  title: t("users.invite.outcome"),
                  key: "outcome",
                  width: 200,
                  render: (_, entry) => (
                    <Tag
                      color={outcomeColors[entry.outcome]}
                      data-testid="invite-outcome"
                    >
                      {t(`users.invite.outcomes.${entry.outcome}`)}
                    </Tag>
                  ),
                },
              ]}
            />
          </>
        )}
        <APIErrorAlert error={error} />
      </Space>
    </Modal>
  );
}
