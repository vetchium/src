import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  Space,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeEmailAddress } from "typespec/common/common";
import { isIdempotencyKey } from "typespec/common/idempotency";
import {
  type EmailChangeChallenge,
  isHubEmailChangeChallengeID,
  normalizeRequestEmailChangeRequest,
  validateRequestEmailChangeRequest,
} from "typespec/hub/auth/email_change";
import { isOperationID, Pending } from "typespec/hub/operations/operations";
import { EmailChangeUnavailableError } from "typespec/problem/hub/email";
import {
  APIError,
  isProblem,
  isRecentAuthenticationRequired,
} from "../../api/client";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { ReauthenticationAlert } from "../../components/common/ReauthenticationAlert";
import { myInfoQueryKey } from "../profile/queries";

interface PendingChange extends EmailChangeChallenge {
  new_email_address: string;
}

/** A confirm the API answered with 202. Replaying the same body under the same
 * idempotency key returns its typed result, however long after the code's own
 * expiry the operation settles. The code was consumed when the change was
 * accepted, so keeping it only makes that replay possible. */
interface AcceptedChange {
  operation_id: string;
  challenge_id: string;
  code: string;
  idempotency_key: string;
}

function storageKey(handle: string): string {
  return `vetchium.hub.email-change.${handle}`;
}

function acceptedStorageKey(handle: string): string {
  return `vetchium.hub.email-change-accepted.${handle}`;
}

function readAcceptedChange(key: string): AcceptedChange | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored === null) return null;
    const value = JSON.parse(stored) as Partial<AcceptedChange>;
    if (
      typeof value.operation_id === "string" &&
      isOperationID(value.operation_id) &&
      typeof value.challenge_id === "string" &&
      isHubEmailChangeChallengeID(value.challenge_id) &&
      typeof value.code === "string" &&
      /^[0-9]{6}$/.test(value.code) &&
      typeof value.idempotency_key === "string" &&
      isIdempotencyKey(value.idempotency_key)
    ) {
      return value as AcceptedChange;
    }
    sessionStorage.removeItem(key);
  } catch {
    // Browser privacy settings may disable session storage.
  }
  return null;
}

/** Whether a replay's error is the accepted change's final result. A transport
 * failure, a server fault, or a lapsed session leaves the change accepted:
 * the replay does not depend on the session, so polling or the next sign-in
 * in this tab replays it again. */
function settlesAcceptedChange(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  if (isProblem(error, EmailChangeUnavailableError.type)) return true;
  return error.status < 500 && error.status !== 401;
}

function storeAcceptedChange(key: string, value: AcceptedChange | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory change still resolves while this page stays open.
  }
}

function readPendingChange(key: string): PendingChange | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored === null) return null;
    const value = JSON.parse(stored) as Partial<PendingChange>;
    if (
      typeof value.challenge_id === "string" &&
      isHubEmailChangeChallengeID(value.challenge_id) &&
      typeof value.expires_at === "string" &&
      Date.parse(value.expires_at) > Date.now() &&
      typeof value.new_email_address === "string"
    ) {
      return value as PendingChange;
    }
    sessionStorage.removeItem(key);
  } catch {
    // Browser privacy settings may disable session storage.
  }
  return null;
}

function storePendingChange(key: string, value: PendingChange | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory change still permits confirmation on this page.
  }
}

export function EmailAddressCard({
  handle,
  currentAddress,
}: {
  handle: string;
  currentAddress: string;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const key = storageKey(handle);
  const acceptedKey = acceptedStorageKey(handle);
  const [pending, setPending] = useState(() => readPendingChange(key));
  const [accepted, setAccepted] = useState(() =>
    readAcceptedChange(acceptedKey),
  );
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [addressForm] = Form.useForm<{ new_email_address: string }>();
  const requestKey = useIdempotencyKey();
  const confirmKey = useIdempotencyKey();
  const lastAddress = useRef<string | null>(null);
  const lastCode = useRef<string | null>(null);

  const forget = () => {
    setPending(null);
    storePendingChange(key, null);
    setCode("");
    lastCode.current = null;
  };
  const remember = (change: AcceptedChange | null) => {
    setAccepted(change);
    storeAcceptedChange(acceptedKey, change);
  };

  useEffect(() => {
    if (pending === null) return;
    const delay = Date.parse(pending.expires_at) - Date.now();
    const timeout = window.setTimeout(
      () => {
        setPending(null);
        storePendingChange(key, null);
      },
      Math.max(delay, 0),
    );
    return () => window.clearTimeout(timeout);
  }, [pending, key]);

  const request = useMutation({
    mutationFn: async (address: string) => {
      if (lastAddress.current !== null && lastAddress.current !== address) {
        requestKey.rotate();
      }
      lastAddress.current = address;
      const release = hold();
      try {
        return await hubAPI.requestEmailChange(
          { new_email_address: address },
          requestKey.current(),
        );
      } finally {
        release();
      }
    },
    onSuccess: (challenge, address) => {
      requestKey.rotate();
      confirmKey.rotate();
      lastAddress.current = null;
      lastCode.current = null;
      const change = { ...challenge, new_email_address: address };
      setPending(change);
      storePendingChange(key, change);
      setCode("");
      setEditing(false);
    },
  });
  // A 202 means the global directory hiccupped; poll the operation, then
  // replay confirm with the same idempotency key and body for the resolved
  // typed result (GU-ECH-005, GU-ECH-007). The accepted change is kept apart
  // from the challenge, whose expiry no longer matters once it is accepted.
  const confirm = useMutation({
    mutationFn: async (replay: AcceptedChange | null) => {
      let sent: Omit<AcceptedChange, "operation_id">;
      if (replay !== null) {
        sent = replay;
      } else {
        if (pending === null) {
          throw new Error("Missing email change challenge");
        }
        if (lastCode.current !== null && lastCode.current !== code) {
          confirmKey.rotate();
        }
        lastCode.current = code;
        sent = {
          challenge_id: pending.challenge_id,
          code,
          idempotency_key: confirmKey.current(),
        };
      }
      const release = hold();
      try {
        const result = await hubAPI.confirmEmailChange(
          { challenge_id: sent.challenge_id, code: sent.code },
          sent.idempotency_key,
        );
        return { result, sent };
      } finally {
        release();
      }
    },
    onSuccess: async ({ result, sent }, replay) => {
      if (result !== undefined) {
        if (replay === null) {
          remember({ ...sent, operation_id: result.operation_id });
          confirmKey.rotate();
          forget();
        }
        return;
      }
      remember(null);
      confirmKey.rotate();
      forget();
      await queryClient.invalidateQueries({ queryKey: myInfoQueryKey });
      void message.success(t("emailChange.changed"));
    },
    onError: (error, replay) => {
      if (replay !== null && settlesAcceptedChange(error)) remember(null);
    },
  });
  useQuery({
    queryKey: ["hub", "email-change-operation", accepted?.operation_id],
    queryFn: async () => {
      if (accepted === null) throw new Error("Missing operation");
      let settled = true;
      try {
        const status = await hubAPI.operationStatus({
          operation_id: accepted.operation_id,
        });
        settled = status.state !== Pending;
      } catch (error) {
        // An operation this session cannot find is answered by the replay.
        if (!(error instanceof APIError && error.status === 404)) throw error;
      }
      if (settled) {
        try {
          await confirm.mutateAsync(accepted);
        } catch {
          // confirm.error now carries the resolved typed problem, if any.
        }
      }
      return settled;
    },
    enabled: accepted !== null && !confirm.isPending,
    refetchInterval: 1000,
    retry: false,
  });

  const sendCode = (address: string) => {
    confirm.reset();
    request.mutate(
      normalizeRequestEmailChangeRequest({ new_email_address: address })
        .new_email_address,
    );
  };
  const cancel = () => {
    forget();
    setEditing(false);
    addressForm.resetFields();
    request.reset();
    confirm.reset();
  };
  const error = request.error ?? confirm.error;
  const expiresAt =
    pending === null
      ? ""
      : new Intl.DateTimeFormat(i18n.language, { timeStyle: "short" }).format(
          new Date(pending.expires_at),
        );

  return (
    <Card title={t("emailChange.title")}>
      <Space orientation="vertical" size="middle" className="full-width">
        <Typography.Text type="secondary">
          {t("emailChange.description")}
        </Typography.Text>
        <Descriptions
          column={1}
          items={[
            {
              key: "current",
              label: t("emailChange.current"),
              children: (
                <Typography.Text data-testid="current-email-address">
                  {currentAddress}
                </Typography.Text>
              ),
            },
          ]}
        />
        {isRecentAuthenticationRequired(error) ? (
          <ReauthenticationAlert />
        ) : (
          <APIErrorAlert error={error} />
        )}
        {accepted !== null ? (
          <Alert
            type="info"
            showIcon
            title={t("emailChange.applying")}
            data-testid="email-change-applying"
          />
        ) : pending !== null ? (
          <Space orientation="vertical" size="middle" className="full-width">
            <Alert
              type="info"
              showIcon
              title={t("emailChange.codeSent", {
                address: pending.new_email_address,
                time: expiresAt,
              })}
              description={t("emailChange.noCodeHint")}
            />
            <Form
              layout="vertical"
              className="settings-form"
              onFinish={() => confirm.mutate(null)}
            >
              <Form.Item
                label={t("emailChange.codeLabel")}
                validateStatus={
                  code === "" || /^[0-9]{6}$/.test(code) ? undefined : "error"
                }
                help={
                  code === "" || /^[0-9]{6}$/.test(code)
                    ? undefined
                    : t("emailChange.codeInvalid")
                }
              >
                <Input
                  aria-label={t("emailChange.codeLabel")}
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  onChange={(event) => setCode(event.target.value.trim())}
                />
              </Form.Item>
              <Flex gap="small" wrap>
                <Button
                  type="primary"
                  htmlType="submit"
                  disabled={!/^[0-9]{6}$/.test(code) || request.isPending}
                  loading={confirm.isPending}
                >
                  {t("emailChange.confirm")}
                </Button>
                <Button
                  disabled={confirm.isPending}
                  loading={request.isPending}
                  onClick={() => sendCode(pending.new_email_address)}
                >
                  {t("emailChange.resend")}
                </Button>
                <Button
                  type="text"
                  disabled={confirm.isPending || request.isPending}
                  onClick={cancel}
                >
                  {t("emailChange.cancel")}
                </Button>
              </Flex>
            </Form>
          </Space>
        ) : editing ? (
          <Form<{ new_email_address: string }>
            form={addressForm}
            layout="vertical"
            className="settings-form"
            onFinish={(values) => sendCode(values.new_email_address)}
          >
            <Form.Item
              name="new_email_address"
              label={t("emailChange.newAddress")}
              extra={t("emailChange.effects")}
              rules={[
                { required: true, message: t("validation.required") },
                {
                  validator: async (_, value: string | undefined) => {
                    if (value === undefined || value === "") return;
                    if (
                      validateRequestEmailChangeRequest({
                        new_email_address: value,
                      }).length > 0
                    ) {
                      throw new Error(t("validation.email"));
                    }
                    if (
                      normalizeEmailAddress(value) ===
                      normalizeEmailAddress(currentAddress)
                    ) {
                      throw new Error(t("emailChange.sameAddress"));
                    }
                  },
                },
              ]}
            >
              <Input type="email" autoComplete="email" autoFocus />
            </Form.Item>
            <Flex gap="small" wrap>
              <Button
                type="primary"
                htmlType="submit"
                loading={request.isPending}
              >
                {t("emailChange.sendCode")}
              </Button>
              <Button disabled={request.isPending} onClick={cancel}>
                {t("emailChange.cancel")}
              </Button>
            </Flex>
          </Form>
        ) : (
          <div>
            <Button onClick={() => setEditing(true)}>
              {t("emailChange.start")}
            </Button>
          </div>
        )}
      </Space>
    </Card>
  );
}
