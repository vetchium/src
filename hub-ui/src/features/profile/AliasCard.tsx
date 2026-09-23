import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Space,
  Spin,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { type HubAlias, isHubAlias } from "typespec/directory/directory";
import { Pending } from "typespec/hub/operations/operations";
import { planIncludes, SilverTier } from "typespec/hub/subscriptions/plans";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useMySubscriptionQuery } from "../subscriptions/queries";
import { aliasProfileURL, canonicalProfileURL } from "./canonical";
import { aliasStateQueryKey, useAliasStateQuery } from "./queries";

interface AliasForm {
  profile_alias: string;
}

/** An alias change is a durable cross-tenant operation, so the API answers with
 * an operation to poll rather than a completed change. */
function useAliasOperation(onSettled: () => Promise<void>) {
  const [operationID, setOperationID] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["hub", "operations", operationID],
    queryFn: async () => {
      if (operationID === null) throw new Error("Missing operation");
      const result = await hubAPI.operationStatus({
        operation_id: operationID,
      });
      if (result.state !== Pending) {
        setOperationID(null);
        await onSettled();
      }
      return result;
    },
    enabled: operationID !== null,
    refetchInterval: 1000,
    retry: false,
  });
  return { operationID, setOperationID, status };
}

function AliasForm({
  handle,
  alias,
  nextChangeAt,
}: {
  handle: string;
  alias: HubAlias | null;
  nextChangeAt: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AliasForm>();
  const key = useIdempotencyKey();
  const lastTarget = useRef<string | null>(null);
  const operation = useAliasOperation(async () => {
    await queryClient.invalidateQueries({ queryKey: aliasStateQueryKey });
    await queryClient.invalidateQueries({ queryKey: ["hub", "profile"] });
  });
  const change = useMutation({
    mutationFn: (value: HubAlias | null) => {
      const target = value ?? "";
      if (lastTarget.current !== null && lastTarget.current !== target) {
        key.rotate();
      }
      lastTarget.current = target;
      return hubAPI.setAlias({ profile_alias: value }, key.current());
    },
    onSuccess: (pending, value) => {
      key.rotate();
      lastTarget.current = null;
      operation.setOperationID(pending.operation_id);
      void message.success(
        value === null
          ? t("profileAlias.removing")
          : t("profileAlias.claiming"),
      );
    },
  });
  const cooldownUntil =
    nextChangeAt === undefined ? null : new Date(nextChangeAt);
  const locked = cooldownUntil !== null && cooldownUntil.getTime() > Date.now();
  const busy = change.isPending || operation.operationID !== null;

  return (
    <>
      <Typography.Paragraph type="secondary">
        {t("profileAlias.canonicalNote", { url: canonicalProfileURL(handle) })}
      </Typography.Paragraph>
      {alias === null ? null : (
        <Typography.Paragraph>
          <Link to={`/u/${alias}`}>{aliasProfileURL(alias)}</Link>
        </Typography.Paragraph>
      )}
      {locked ? (
        <Alert
          type="info"
          showIcon
          title={t("profileAlias.cooldown", {
            date: new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(cooldownUntil),
          })}
        />
      ) : null}
      <Form<AliasForm>
        form={form}
        layout="vertical"
        initialValues={{ profile_alias: alias ?? "" }}
        onFinish={(values) => change.mutate(values.profile_alias as HubAlias)}
      >
        <Form.Item
          name="profile_alias"
          label={t("profileAlias.label")}
          help={t("profileAlias.rules")}
          rules={[
            {
              validator: async (_, value: string) => {
                if (!isHubAlias(value ?? "")) {
                  throw new Error(t("profileAlias.invalid"));
                }
              },
            },
          ]}
        >
          <Input disabled={locked || busy} autoComplete="off" />
        </Form.Item>
        <Space>
          <Button
            type="primary"
            htmlType="submit"
            disabled={locked || busy}
            loading={busy}
          >
            {t("profileAlias.save")}
          </Button>
          <Button
            danger
            disabled={alias === null || locked || busy}
            onClick={() => change.mutate(null)}
          >
            {t("profileAlias.remove")}
          </Button>
        </Space>
      </Form>
      <APIErrorAlert error={change.error ?? operation.status.error} />
      {operation.status.data?.state === "failed" ? (
        <Alert type="error" showIcon title={t("profileAlias.failed")} />
      ) : null}
    </>
  );
}

export function AliasCard({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const subscription = useMySubscriptionQuery();
  const entitled =
    subscription.data !== undefined &&
    planIncludes(subscription.data.plan_oid, SilverTier);
  const state = useAliasStateQuery(entitled);

  return (
    <Card title={t("profileAlias.title")}>
      {subscription.isPending ? (
        <Spin aria-label={t("profileAlias.loading")} />
      ) : !entitled ? (
        <Space orientation="vertical">
          <Typography.Paragraph type="secondary">
            {t("profileAlias.upgradeRequired")}
          </Typography.Paragraph>
          <Link to="/plan">{t("profileAlias.viewPlans")}</Link>
        </Space>
      ) : state.isPending ? (
        <Spin aria-label={t("profileAlias.loading")} />
      ) : state.isError ? (
        <Space orientation="vertical">
          <APIErrorAlert error={state.error} />
          <Button onClick={() => void state.refetch()}>
            {t("common.retry")}
          </Button>
        </Space>
      ) : (
        <AliasForm
          handle={handle}
          alias={state.data.profile_alias}
          nextChangeAt={state.data.next_change_at}
        />
      )}
    </Card>
  );
}
