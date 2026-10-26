import { ArrowRightOutlined } from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Button, Card, Divider, Flex, Tag, Typography } from "antd";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { isDefiniteRefusal } from "../../api/client";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { useUnsavedChangesGuard } from "../../components/common/useUnsavedChangesGuard";
import { useOpeningProvidersQuery } from "../marketplace/queries";
import { pipelineProblem } from "./problems";
import {
  useOpeningPipelineQuery,
  useReplaceOpeningPipelineMutation,
  useStageCountsQuery,
} from "./queries";
import { StageListEditor } from "./StageListEditor";
import {
  rowsFromStages,
  rowsProblem,
  type StageRow,
  sameRows,
  toInputs,
} from "./stageRows";

interface Props {
  openingNumber: number;
  /** False once the Opening is closed or expired, or for a reader. */
  editable: boolean;
}

// What follows the last stage is fixed; the pipeline never lists it.
const afterStages = ["offer", "offerAccepted", "joined"] as const;

export function PipelineTab({ openingNumber, editable }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const query = useOpeningPipelineQuery(openingNumber);
  const counts = useStageCountsQuery(openingNumber);
  const openingProviders = useOpeningProvidersQuery(openingNumber);
  const replace = useReplaceOpeningPipelineMutation(openingNumber);
  const key = useIdempotencyKey(`opening-pipeline:${openingNumber}`);
  // Undefined while the user has no edits, so the rows follow the server.
  const [draft, setDraft] = useState<StageRow[]>();
  const [error, setError] = useState<{ message: string; inUse?: boolean }>();
  const pipeline = query.data;
  const serverRows = pipeline ? rowsFromStages(pipeline.stages) : [];
  const rows = draft ?? serverRows;
  const dirty = draft !== undefined && !sameRows(draft, serverRows);
  const problem = rowsProblem(rows);
  useUnsavedChangesGuard(dirty);

  const candidates = new Map(
    (counts.data?.stages ?? []).map((entry) => [entry.stage.id, entry.count]),
  );

  const change = (next: StageRow[]) => {
    key.rotate();
    setError(undefined);
    setDraft(next);
  };

  const discard = () => {
    key.rotate();
    setError(undefined);
    setDraft(undefined);
  };

  const save = async () => {
    if (!pipeline || !dirty || problem !== "none" || replace.isPending) return;
    setError(undefined);
    try {
      await replace.mutateAsync({
        request: {
          opening_number: openingNumber,
          version: pipeline.version,
          stages: toInputs(rows),
        },
        key: key.current(),
      });
      key.rotate();
      setDraft(undefined);
      void counts.refetch();
      void message.success(t("pipeline.saved"));
    } catch (cause) {
      const failure = pipelineProblem(cause);
      if (failure.kind === "stage-in-use") {
        setError({ message: t("pipeline.errors.inUse"), inUse: true });
      } else if (failure.kind === "version-conflict") {
        void query.refetch();
        setError({ message: t("pipeline.errors.versionConflict") });
      } else if (failure.kind === "opening-unavailable") {
        void query.refetch();
        setError({ message: t("pipeline.errors.unavailable") });
      } else if (failure.kind === "unknown-stage") {
        void query.refetch();
        setError({ message: t("pipeline.errors.unknownStage") });
      } else {
        setError({ message: problemMessage(t, cause) });
      }
      if (isDefiniteRefusal(cause)) key.rotate();
    }
  };

  if (query.isLoading) return <Card loading />;
  if (query.isError || !pipeline)
    return (
      <Alert
        type="error"
        showIcon
        title={t("common.loadError")}
        action={
          <Button onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );

  const notes = (row: StageRow) => {
    const held = row.id === undefined ? undefined : candidates.get(row.id);
    const holdsCandidates = held !== undefined && held > 0;
    const stageAssignments =
      row.id !== undefined
        ? openingProviders.data?.stages.find((s) => s.stage.id === row.id)
            ?.assignments
        : undefined;
    const assignedCount = stageAssignments?.length ?? 0;

    let providerNote: string;
    if (row.kind === "review") {
      providerNote = t("pipeline.inHouseOnly");
    } else if (assignedCount > 0) {
      providerNote = t("pipeline.providerAssigned", { count: assignedCount });
    } else {
      providerNote = t("pipeline.inHouse");
    }

    return (
      <Flex vertical style={{ paddingInlineStart: "2em" }}>
        {!row.removed && (
          <Typography.Text type="secondary">
            {holdsCandidates
              ? `${t("pipeline.candidatesHere", { count: held })} · ${providerNote}`
              : providerNote}
          </Typography.Text>
        )}
        {row.removed && holdsCandidates && (
          <Typography.Text type="danger" role="alert">
            {t("pipeline.removeHoldsCandidates", { name: row.name })}
          </Typography.Text>
        )}
        {row.removed && error?.inUse && !holdsCandidates && (
          <Typography.Text type="danger" role="alert">
            {t("pipeline.removeRefused", { name: row.name })}
          </Typography.Text>
        )}
      </Flex>
    );
  };

  return (
    <Card title={t("pipeline.stages")}>
      <Flex vertical gap="middle">
        <Typography.Text type="secondary">
          {t("pipeline.intro")}
        </Typography.Text>
        {dirty && (
          <Flex gap="small" align="center" wrap>
            <Tag color="warning">{t("pipeline.unsaved")}</Tag>
            <Button disabled={replace.isPending} onClick={discard}>
              {t("pipeline.discard")}
            </Button>
            <Button
              type="primary"
              loading={replace.isPending}
              disabled={problem !== "none"}
              onClick={() => void save()}
            >
              {t("pipeline.save")}
            </Button>
          </Flex>
        )}
        {!editable && (
          <Alert type="info" showIcon title={t("pipeline.readOnly")} />
        )}
        {dirty && problem !== "none" && (
          <Alert
            type="warning"
            showIcon
            title={t(`pipeline.problems.${problem}`)}
          />
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            title={error.message}
            closable={{ onClose: () => setError(undefined) }}
          />
        )}
        <StageListEditor
          rows={rows}
          onChange={change}
          disabled={!editable || replace.isPending}
          notes={notes}
        />
        <Divider size="small" />
        <Flex gap="small" align="center" wrap>
          <Typography.Text type="secondary">
            {t("pipeline.afterLast")}
          </Typography.Text>
          {afterStages.map((stage, index) => (
            <Fragment key={stage}>
              {index > 0 && <ArrowRightOutlined aria-hidden />}
              <Tag>{t(`pipeline.after.${stage}`)}</Tag>
            </Fragment>
          ))}
          <Typography.Text type="secondary">
            {t("pipeline.offerAnywhere")}
          </Typography.Text>
        </Flex>
      </Flex>
    </Card>
  );
}
