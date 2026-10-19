import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Button, Card, Flex, Select, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import { isDefiniteRefusal } from "../../api/client";
import { type ConfirmAction, ConfirmActionDialog } from "./ConfirmActionDialog";
import { type DateAction, DateDialog } from "./DateDialog";
import { applicationErrorMessage } from "./errors";
import { NotProgressingDialog } from "./NotProgressingDialog";
import { stageText } from "./presentation";
import { useMoveApplicationStageMutation } from "./queries";
import { ShortlistDialog } from "./ShortlistDialog";

interface Props {
  detail: ApplicationDetail;
  openingNumber: number;
  /** The Opening's whole pipeline in order. */
  stages: readonly PipelineStage[];
  canAct: boolean;
}

type Dialog =
  | { kind: "shortlist" }
  | { kind: "not-progressing" }
  | { kind: "confirm"; action: ConfirmAction }
  | { kind: "date"; action: DateAction };

/**
 * The actions the application's state allows, for someone who may act. The
 * API still decides each one. Offer, interview, and result actions join these
 * in the same card.
 */
export function ApplicationActions({
  detail,
  openingNumber,
  stages,
  canAct,
}: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const move = useMoveApplicationStageMutation();
  const moveKey = useIdempotencyKey(
    `move:${openingNumber}:${detail.application_number}`,
  );
  const [dialog, setDialog] = useState<Dialog>();
  const [target, setTarget] = useState<string>();
  const [moveError, setMoveError] = useState<string>();
  const state = detail.state;

  const currentIndex = stages.findIndex(
    (stage) => stage.id === detail.current_stage?.id,
  );
  const later = currentIndex < 0 ? [] : stages.slice(currentIndex + 1);
  const targetIndex = later.findIndex((stage) => stage.id === target);
  const skipped = targetIndex > 0 ? later.slice(0, targetIndex) : [];
  const currentRecord = detail.stage_records.find(
    (record) => record.stage.id === detail.current_stage?.id,
  );
  const reviewPending =
    state === "in_pipeline" &&
    detail.current_stage?.kind === "review" &&
    currentRecord?.status === "pending";

  const doMove = async () => {
    if (target === undefined || move.isPending) return;
    setMoveError(undefined);
    try {
      await move.mutateAsync({
        request: {
          opening_number: openingNumber,
          application_number: detail.application_number,
          version: detail.version,
          stage_id: target,
        },
        key: moveKey.current(),
      });
      moveKey.rotate();
      setTarget(undefined);
      void message.success(t("applications.actions.moved"));
    } catch (cause) {
      setMoveError(applicationErrorMessage(t, cause));
      if (isDefiniteRefusal(cause)) moveKey.rotate();
    }
  };

  const terminal = [
    "joined",
    "did_not_join",
    "offer_declined",
    "not_progressing",
    "withdrawn",
  ].includes(state);
  const hasActions =
    state === "submitted" ||
    state === "in_pipeline" ||
    state === "offered" ||
    state === "offer_accepted" ||
    state === "joined";

  let body: React.ReactNode;
  if (!canAct) {
    body = (
      <Typography.Text type="secondary">
        {t("applications.actions.readOnly")}
      </Typography.Text>
    );
  } else if (!hasActions) {
    body = (
      <Typography.Text type="secondary">
        {t("applications.actions.none")}
      </Typography.Text>
    );
  } else {
    body = (
      <Flex vertical gap="middle">
        {moveError && (
          <Alert
            type="error"
            showIcon
            title={moveError}
            closable={{ onClose: () => setMoveError(undefined) }}
          />
        )}
        {state === "submitted" && (
          <Button
            type="primary"
            disabled={stages.length === 0}
            onClick={() => setDialog({ kind: "shortlist" })}
          >
            {t("applications.shortlist.action")}
          </Button>
        )}
        {state === "in_pipeline" && later.length > 0 && (
          <Flex vertical gap="small">
            <Typography.Text strong>
              {t("applications.actions.moveLabel")}
            </Typography.Text>
            <Flex gap="small">
              <Select
                className="full-width"
                aria-label={t("applications.actions.moveLabel")}
                placeholder={t("applications.actions.choosePlaceholder")}
                value={target}
                disabled={move.isPending}
                onChange={(value) => {
                  moveKey.rotate();
                  setTarget(value);
                }}
                options={later.map((stage) => ({
                  value: stage.id,
                  label: stageText(t, stage),
                }))}
              />
              <Button
                disabled={target === undefined}
                loading={move.isPending}
                onClick={() => void doMove()}
              >
                {t("applications.actions.move")}
              </Button>
            </Flex>
            <Typography.Text type="secondary">
              {skipped.length > 0
                ? t("applications.actions.willSkip", {
                    stages: skipped.map((stage) => stage.name).join(", "),
                  })
                : t("applications.actions.skipHelp")}
            </Typography.Text>
          </Flex>
        )}
        {reviewPending && (
          <Button
            onClick={() =>
              setDialog({ kind: "confirm", action: "complete-stage" })
            }
          >
            {t("applications.actions.completeReview")}
          </Button>
        )}
        {state === "offer_accepted" && (
          <>
            <Button
              type="primary"
              onClick={() =>
                setDialog({ kind: "date", action: "record-joined" })
              }
            >
              {t("applications.dates.record-joined.action")}
            </Button>
            <Button
              danger
              onClick={() =>
                setDialog({ kind: "confirm", action: "did-not-join" })
              }
            >
              {t("applications.confirm.did-not-join.action")}
            </Button>
          </>
        )}
        {state === "joined" && (
          <>
            {detail.separated_on === undefined && (
              <Button
                onClick={() =>
                  setDialog({ kind: "date", action: "record-separated" })
                }
              >
                {t("applications.dates.record-separated.action")}
              </Button>
            )}
            <Button
              onClick={() =>
                setDialog({ kind: "date", action: "correct-joined" })
              }
            >
              {t("applications.dates.correct-joined.action")}
            </Button>
            {detail.separated_on !== undefined && (
              <Button
                onClick={() =>
                  setDialog({ kind: "date", action: "correct-separated" })
                }
              >
                {t("applications.dates.correct-separated.action")}
              </Button>
            )}
          </>
        )}
        {!terminal && state !== "joined" && (
          <Button danger onClick={() => setDialog({ kind: "not-progressing" })}>
            {t("applications.notProgressing.action")}
          </Button>
        )}
      </Flex>
    );
  }

  return (
    <Card title={t("applications.actions.title")}>
      {body}
      {dialog?.kind === "shortlist" && (
        <ShortlistDialog
          openingNumber={openingNumber}
          application={{
            ...detail,
            display_name: detail.snapshot.display_name,
          }}
          stages={stages}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "not-progressing" && (
        <NotProgressingDialog
          openingNumber={openingNumber}
          application={{
            ...detail,
            display_name: detail.snapshot.display_name,
          }}
          candidacy={state !== "submitted"}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "confirm" && (
        <ConfirmActionDialog
          action={dialog.action}
          detail={detail}
          openingNumber={openingNumber}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "date" && (
        <DateDialog
          action={dialog.action}
          detail={detail}
          openingNumber={openingNumber}
          onClose={() => setDialog(undefined)}
        />
      )}
    </Card>
  );
}
