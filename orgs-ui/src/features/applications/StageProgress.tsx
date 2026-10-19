import { Card, Steps } from "antd";
import { useTranslation } from "react-i18next";
import type {
  ApplicationDetail,
  ApplicationState,
} from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import { stageKindLabel, stateLabel } from "./presentation";

type StepStatus = "wait" | "process" | "finish" | "error";

const ended: readonly ApplicationState[] = [
  "not_progressing",
  "withdrawn",
  "offer_declined",
  "did_not_join",
];

interface Props {
  detail: ApplicationDetail;
  /** The Opening's whole pipeline in order. */
  stages: readonly PipelineStage[];
}

/** Where the application stands: each stage, then the fixed steps after them. */
export function StageProgress({ detail, stages }: Props) {
  const { t } = useTranslation();
  const records = new Map(
    detail.stage_records.map((record) => [record.stage.id, record.status]),
  );
  const state = detail.state;
  const stopped = ended.includes(state);
  const stageItems = stages.map((stage, index) => {
    const current = detail.current_stage?.id === stage.id;
    const record = records.get(stage.id);
    let status: StepStatus = "wait";
    let content = stageKindLabel(t, stage.kind);
    if (record === "completed") {
      status = "finish";
      content = t("applications.progress.completed");
    } else if (record === "skipped") {
      status = "finish";
      content = t("applications.progress.skipped");
    }
    if (current) {
      if (stopped) {
        status = "error";
        content = stateLabel(t, state);
      } else if (state === "in_pipeline") {
        status = "process";
        content = t("applications.progress.current");
      }
    }
    return { key: stage.id, title: stage.name, content, status, index };
  });
  const offerStatus = (
    reached: ApplicationState[],
    active: ApplicationState,
  ): StepStatus =>
    state === active ? "process" : reached.includes(state) ? "finish" : "wait";
  const after = [
    {
      key: "offer",
      title: t("applications.progress.offer"),
      status: offerStatus(
        ["offer_accepted", "joined", "did_not_join"],
        "offered",
      ),
    },
    {
      key: "accepted",
      title: t("applications.progress.accepted"),
      status: offerStatus(["joined", "did_not_join"], "offer_accepted"),
    },
    {
      key: "joined",
      title: t("applications.progress.joined"),
      status: state === "joined" ? ("finish" as const) : ("wait" as const),
    },
  ];
  return (
    <Card title={t("applications.progress.title")}>
      <Steps
        size="small"
        orientation="vertical"
        items={[
          ...stageItems.map(({ key, title, content, status }) => ({
            key,
            title,
            content,
            status,
          })),
          ...after,
        ]}
      />
    </Card>
  );
}
