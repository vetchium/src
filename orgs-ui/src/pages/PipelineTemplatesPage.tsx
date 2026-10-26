import { PlusOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PipelineTemplate } from "typespec/orgs/hiring/pipelines";
import { maxPipelineTemplates } from "typespec/orgs/hiring/pipelines";
import { isDefiniteRefusal } from "../api/client";
import { problemMessage } from "../components/common/APIErrorAlert";
import { pipelineProblem } from "../features/pipelines/problems";
import {
  useDeletePipelineTemplateMutation,
  usePipelineTemplatesQuery,
} from "../features/pipelines/queries";
import { StageSummary } from "../features/pipelines/StageSummary";
import { TemplateDrawer } from "../features/pipelines/TemplateDrawer";

type Editing = { template: PipelineTemplate | undefined } | undefined;

export function PipelineTemplatesPage() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const { date } = useDateTimeFormat();
  const query = usePipelineTemplatesQuery();
  const remove = useDeletePipelineTemplateMutation();
  const removeKey = useIdempotencyKey("pipeline-template-delete");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing>();
  const [error, setError] = useState<string>();
  const templates = query.data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const shown = templates.filter((template) =>
    template.name.toLocaleLowerCase().includes(needle),
  );
  const full = templates.length >= maxPipelineTemplates;

  const confirmDelete = (template: PipelineTemplate) =>
    modal.confirm({
      title: t("pipeline.template.deleteTitle", { name: template.name }),
      content: t("pipeline.template.deleteBody"),
      okText: t("pipeline.template.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        setError(undefined);
        try {
          await remove.mutateAsync({
            request: { template_id: template.id },
            key: removeKey.current(),
          });
          removeKey.rotate();
          void message.success(
            t("pipeline.template.deleted", { name: template.name }),
          );
        } catch (cause) {
          if (pipelineProblem(cause).kind === "template-not-found")
            setError(t("pipeline.template.gone"));
          else setError(problemMessage(t, cause));
          if (isDefiniteRefusal(cause)) removeKey.rotate();
        }
      },
    });

  const columns: ColumnsType<PipelineTemplate> = [
    {
      title: t("pipeline.template.name"),
      dataIndex: "name",
      width: 220,
      render: (name: string, template) => (
        <Button type="link" onClick={() => setEditing({ template })}>
          {name}
        </Button>
      ),
    },
    {
      title: t("pipeline.stages"),
      dataIndex: "stages",
      render: (_: unknown, template) => (
        <StageSummary stages={template.stages} />
      ),
    },
    {
      title: t("pipeline.template.updated"),
      dataIndex: "updated_at",
      width: 140,
      render: (value: string) => date(value),
    },
    {
      title: t("pipeline.actions"),
      key: "actions",
      width: 160,
      render: (_: unknown, template) => (
        <Space>
          <Button
            size="small"
            aria-label={t("pipeline.template.editNamed", {
              name: template.name,
            })}
            onClick={() => setEditing({ template })}
          >
            {t("pipeline.template.edit")}
          </Button>
          <Button
            size="small"
            danger
            type="text"
            aria-label={t("pipeline.template.deleteNamed", {
              name: template.name,
            })}
            onClick={() => confirmDelete(template)}
          >
            {t("pipeline.template.delete")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("pipeline.template.documentTitle")}</title>
      <Flex align="center" justify="space-between" wrap gap="middle">
        <div>
          <Typography.Title level={1}>
            {t("pipeline.template.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("pipeline.template.intro")}
          </Typography.Text>
        </div>
        <Flex vertical align="end" gap={4}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={full}
            onClick={() => setEditing({ template: undefined })}
          >
            {t("pipeline.template.new")}
          </Button>
          {full && (
            <Typography.Text type="secondary">
              {t("pipeline.template.limit", { limit: maxPipelineTemplates })}
            </Typography.Text>
          )}
        </Flex>
      </Flex>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(undefined) }}
        />
      )}
      <Card>
        <Flex vertical gap="middle">
          <Flex justify="space-between" align="center" wrap gap="small">
            <Input.Search
              className="toolbar-search"
              aria-label={t("pipeline.template.search")}
              placeholder={t("pipeline.template.search")}
              allowClear
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Typography.Text type="secondary">
              {t("pipeline.template.count", {
                count: templates.length,
                limit: maxPipelineTemplates,
              })}
            </Typography.Text>
          </Flex>
          {query.isError ? (
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
          ) : (
            <Table<PipelineTemplate>
              rowKey="id"
              columns={columns}
              dataSource={shown}
              loading={query.isLoading}
              pagination={false}
              locale={{
                emptyText:
                  templates.length === 0 ? (
                    <Empty description={t("pipeline.template.empty")}>
                      <Button
                        type="primary"
                        onClick={() => setEditing({ template: undefined })}
                      >
                        {t("pipeline.template.new")}
                      </Button>
                    </Empty>
                  ) : (
                    <Empty description={t("pipeline.template.noMatch")} />
                  ),
              }}
            />
          )}
        </Flex>
      </Card>
      {editing && (
        <TemplateDrawer
          key={editing.template?.id ?? "new"}
          template={editing.template}
          open
          onClose={() => setEditing(undefined)}
        />
      )}
    </Space>
  );
}
