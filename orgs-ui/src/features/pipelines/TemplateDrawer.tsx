import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Button, Drawer, Flex, Form, Input, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PipelineTemplate } from "typespec/orgs/hiring/pipelines";
import { isDefiniteRefusal } from "../../api/client";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { useUnsavedChangesGuard } from "../../components/common/useUnsavedChangesGuard";
import { pipelineProblem } from "./problems";
import {
  useCreatePipelineTemplateMutation,
  useUpdatePipelineTemplateMutation,
} from "./queries";
import { StageListEditor } from "./StageListEditor";
import {
  newRow,
  rowsFromDefinitions,
  rowsProblem,
  sameRows,
  toDefinitions,
} from "./stageRows";

interface Props {
  /** The template to edit, or undefined to start a new one. */
  template: PipelineTemplate | undefined;
  open: boolean;
  onClose: () => void;
}

export function TemplateDrawer({ template, open, onClose }: Props) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const create = useCreatePipelineTemplateMutation();
  const update = useUpdatePipelineTemplateMutation();
  const key = useIdempotencyKey(`pipeline-template:${template?.id ?? "new"}`);
  const [initial] = useState(() => ({
    name: template?.name ?? "",
    rows: template ? rowsFromDefinitions(template.stages) : [newRow()],
  }));
  const [name, setName] = useState(initial.name);
  const [rows, setRows] = useState(initial.rows);
  const [nameError, setNameError] = useState<string>();
  const [error, setError] = useState<string>();
  const pending = create.isPending || update.isPending;
  const dirty = name !== initial.name || !sameRows(rows, initial.rows);
  const nameValid = name.trim().length >= 1 && [...name.trim()].length <= 100;
  const stagesProblem = rowsProblem(rows);
  const blocker = !nameValid
    ? t("pipeline.template.nameRequired")
    : stagesProblem === "name"
      ? t("pipeline.template.stageNameRequired")
      : stagesProblem === "criterion"
        ? t("pipeline.problems.criterion")
        : undefined;
  useUnsavedChangesGuard(open && dirty);

  const edited = () => {
    key.rotate();
    setError(undefined);
    setNameError(undefined);
  };

  const close = () => {
    if (pending) return;
    if (!dirty) {
      onClose();
      return;
    }
    modal.confirm({
      title: t("common.unsavedTitle"),
      content: t("common.unsavedContent"),
      okText: t("common.unsavedLeave"),
      cancelText: t("common.unsavedStay"),
      onOk: onClose,
    });
  };

  const save = async () => {
    if (blocker !== undefined || stagesProblem !== "none" || pending) return;
    setError(undefined);
    try {
      const body = { name: name.trim(), stages: toDefinitions(rows) };
      if (template)
        await update.mutateAsync({
          request: { template_id: template.id, ...body },
          key: key.current(),
        });
      else await create.mutateAsync({ request: body, key: key.current() });
      key.rotate();
      void message.success(t("pipeline.template.saved", { name: body.name }));
      onClose();
    } catch (cause) {
      const problem = pipelineProblem(cause);
      if (problem.kind === "name-taken")
        setNameError(t("pipeline.template.nameTaken"));
      else if (problem.kind === "template-limit")
        setError(t("pipeline.template.limit", { limit: problem.limit }));
      else if (problem.kind === "template-not-found")
        setError(t("pipeline.template.gone"));
      else setError(problemMessage(t, cause));
      if (isDefiniteRefusal(cause)) key.rotate();
    }
  };

  return (
    <Drawer
      open={open}
      destroyOnHidden
      size="min(560px, 100vw)"
      title={
        <Flex gap="small" align="center" wrap>
          {template
            ? t("pipeline.template.editTitle")
            : t("pipeline.template.newTitle")}
          {dirty && <Tag color="warning">{t("pipeline.unsaved")}</Tag>}
        </Flex>
      }
      onClose={close}
      maskClosable={!dirty}
      footer={
        <Flex justify="flex-end" align="center" gap="small" wrap>
          {blocker !== undefined && (
            <span role="status" style={{ flex: "1 1 200px" }}>
              {blocker}
            </span>
          )}
          <Button disabled={pending} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            type="primary"
            loading={pending}
            disabled={blocker !== undefined || stagesProblem !== "none"}
            onClick={() => void save()}
          >
            {t("pipeline.template.save")}
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap="middle">
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            closable={{ onClose: () => setError(undefined) }}
          />
        )}
        <Form layout="vertical" component="div" requiredMark={false}>
          <Form.Item
            label={t("pipeline.template.name")}
            htmlFor="pipeline-template-name"
            extra={t("pipeline.template.nameHelp")}
            {...(nameError !== undefined && {
              validateStatus: "error" as const,
              help: nameError,
            })}
          >
            <Input
              id="pipeline-template-name"
              value={name}
              maxLength={100}
              disabled={pending}
              onChange={(event) => {
                setName(event.target.value);
                edited();
              }}
            />
          </Form.Item>
          <Form.Item
            label={t("pipeline.stages")}
            extra={t("pipeline.template.stagesHelp")}
          >
            <StageListEditor
              rows={rows}
              disabled={pending}
              onChange={(next) => {
                setRows(next);
                edited();
              }}
            />
          </Form.Item>
        </Form>
      </Flex>
    </Drawer>
  );
}
