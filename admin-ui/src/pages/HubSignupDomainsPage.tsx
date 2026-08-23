import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import {
  ManageHubSignupDomains,
  ViewHubSignupDomains,
} from "../../../typespec/admin/authorization/types.ts";
import type {
  Domain,
  ListRequest,
  State,
} from "../../../typespec/admin/hub-signup-domains/domains.ts";
import {
  isDisableComment,
  isDomainName,
  normalizeDomainName,
} from "../../../typespec/admin/hub-signup-domains/domains.ts";
import type { PaginationKey } from "../../../typespec/common/pagination.ts";
import {
  HubSignupDomainAlreadyExistsError,
  HubSignupDomainNotFoundError,
} from "../../../typespec/problem/admin/hub-signup-domains.ts";
import { problemTranslationKey } from "../api/problems";
import { intlLocale } from "../app/preferences";
import {
  createHubSignupDomain,
  updateHubSignupDomain,
} from "../features/hub-signup-domains/api";
import {
  hubSignupDomainsQueryKey,
  useHubSignupDomainsQuery,
} from "../features/hub-signup-domains/queries";
import { useMyInfoQuery } from "../features/profile/queries";

interface Filters {
  search?: string;
  state?: State;
}

interface DomainFormValues {
  domain: string;
  state: State;
  disabled_comment?: string;
}

const mutationProblems = {
  [HubSignupDomainAlreadyExistsError.type]:
    "hubSignupDomains.errors.alreadyExists",
  [HubSignupDomainNotFoundError.type]: "hubSignupDomains.errors.notFound",
};

export function HubSignupDomainsPage() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const [form] = Form.useForm<DomainFormValues>();
  const selectedState = Form.useWatch("state", form);
  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState("");
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Domain | null>(null);
  const request: ListRequest = {
    limit: 25,
    pagination_key: pageKeys[pageIndex],
    filter_search: filters.search,
    filter_state: filters.state,
  };
  const query = useHubSignupDomainsQuery(request);
  const saveMutation = useMutation({
    mutationFn: (values: DomainFormValues) => {
      const domain = normalizeDomainName(values.domain);
      const disabledComment =
        values.state === "disabled"
          ? values.disabled_comment?.trim()
          : undefined;
      return editing === null
        ? createHubSignupDomain({
            domain,
            state: values.state,
            ...(disabledComment === undefined
              ? {}
              : { disabled_comment: disabledComment }),
          })
        : updateHubSignupDomain({
            hub_signup_domain_id: editing.hub_signup_domain_id,
            domain,
            state: values.state,
            ...(disabledComment === undefined
              ? {}
              : { disabled_comment: disabledComment }),
          });
    },
  });

  const allowed = me?.permissions.includes(ViewHubSignupDomains) === true;
  if (me === undefined) return <Spin size="large" />;
  if (!allowed) return <Navigate replace to="/" />;

  const canManage = me.permissions.includes(ManageHubSignupDomains);
  const resetPagination = () => {
    setPageKeys([undefined]);
    setPageIndex(0);
  };
  const refresh = async () => {
    resetPagination();
    await queryClient.invalidateQueries({ queryKey: hubSignupDomainsQueryKey });
  };
  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    resetPagination();
  };
  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      domain: "",
      state: "active",
      disabled_comment: undefined,
    });
    setEditorOpen(true);
  };
  const openEdit = (entry: Domain) => {
    setEditing(entry);
    form.setFieldsValue({
      domain: entry.domain,
      state: entry.state,
      disabled_comment: entry.disabled_comment,
    });
    setEditorOpen(true);
  };
  const closeEditor = () => {
    if (saveMutation.isPending) return;
    setEditorOpen(false);
    setEditing(null);
    form.resetFields();
  };
  const save = async (values: DomainFormValues) => {
    try {
      await saveMutation.mutateAsync(values);
      void message.success(
        t(
          editing === null
            ? "hubSignupDomains.create.done"
            : "hubSignupDomains.edit.done",
        ),
      );
      closeEditor();
      await refresh();
    } catch (error) {
      void message.error(t(problemTranslationKey(error, mutationProblems)));
    }
  };
  const columns: ColumnsType<Domain> = [
    {
      title: t("fields.domain"),
      dataIndex: "domain",
      key: "domain",
      render: (domain: string) => (
        <Typography.Text strong copyable>
          {domain}
        </Typography.Text>
      ),
    },
    {
      title: t("fields.state"),
      dataIndex: "state",
      key: "state",
      width: 140,
      render: (state: State) => (
        <Tag color={state === "active" ? "green" : "default"}>
          {t(`states.${state}`)}
        </Tag>
      ),
    },
    {
      title: t("fields.updated"),
      dataIndex: "updated_at",
      key: "updated_at",
      width: 200,
      responsive: ["md"],
      render: (value: string) =>
        new Intl.DateTimeFormat(intlLocale(i18n.language), {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value)),
    },
    {
      title: t("hubSignupDomains.form.disabledCommentLabel"),
      dataIndex: "disabled_comment",
      key: "disabled_comment",
      responsive: ["lg"],
      render: (comment: string | undefined) =>
        comment ?? t("common.notApplicable"),
    },
    ...(canManage
      ? [
          {
            title: t("fields.actions"),
            key: "actions",
            width: 80,
            render: (_: unknown, entry: Domain) => (
              <Button
                icon={<EditOutlined />}
                aria-label={t("hubSignupDomains.edit.for", {
                  domain: entry.domain,
                })}
                onClick={() => openEdit(entry)}
              />
            ),
          },
        ]
      : []),
  ];

  const next = () => {
    const key = query.data?.next_pagination_key;
    if (key === undefined) return;
    setPageKeys((keys) => [...keys.slice(0, pageIndex + 1), key]);
    setPageIndex((index) => index + 1);
  };

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <Flex align="flex-start" justify="space-between" gap="middle" wrap>
        <div>
          <Typography.Title level={1}>
            {t("hubSignupDomains.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("hubSignupDomains.description")}
          </Typography.Text>
        </div>
        {canManage ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("hubSignupDomains.create.action")}
          </Button>
        ) : null}
      </Flex>

      <Alert
        type="info"
        showIcon
        title={t("hubSignupDomains.scope.title")}
        description={t("hubSignupDomains.scope.description")}
      />

      <Card>
        <Flex gap="middle" align="center" wrap>
          <Input.Search
            className="administrator-search"
            allowClear
            value={search}
            placeholder={t("hubSignupDomains.searchPlaceholder")}
            aria-label={t("hubSignupDomains.searchPlaceholder")}
            onChange={(event) => {
              setSearch(event.target.value);
              if (event.target.value === "") {
                updateFilters({ search: undefined });
              }
            }}
            onSearch={(value) =>
              updateFilters({ search: value.trim() || undefined })
            }
          />
          <Segmented
            aria-label={t("hubSignupDomains.stateFilter")}
            value={filters.state ?? "all"}
            options={[
              { value: "all", label: t("common.all") },
              { value: "active", label: t("states.active") },
              { value: "disabled", label: t("states.disabled") },
            ]}
            onChange={(value) =>
              updateFilters({
                state: value === "all" ? undefined : (value as State),
              })
            }
          />
        </Flex>
      </Card>

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
        <Table<Domain>
          rowKey="hub_signup_domain_id"
          loading={query.isFetching}
          columns={columns}
          dataSource={query.data?.domains ?? []}
          pagination={false}
          locale={{
            emptyText: t(
              filters.search !== undefined || filters.state !== undefined
                ? "hubSignupDomains.empty.filtered"
                : "hubSignupDomains.empty.default",
            ),
          }}
        />
      )}

      <Flex justify="space-between" align="center">
        <Typography.Text type="secondary">
          {t("hubSignupDomains.page", { page: pageIndex + 1 })}
        </Typography.Text>
        <Space>
          <Button
            disabled={query.isFetching || pageIndex === 0}
            onClick={() => setPageIndex((index) => index - 1)}
          >
            {t("common.previous")}
          </Button>
          <Button
            disabled={
              query.isFetching || query.data?.next_pagination_key === undefined
            }
            onClick={next}
          >
            {t("common.next")}
          </Button>
        </Space>
      </Flex>

      <Modal
        destroyOnHidden
        open={editorOpen}
        closable={!saveMutation.isPending}
        keyboard={!saveMutation.isPending}
        mask={{ closable: !saveMutation.isPending }}
        title={t(
          editing === null
            ? "hubSignupDomains.create.title"
            : "hubSignupDomains.edit.title",
        )}
        okText={t(
          editing === null ? "hubSignupDomains.create.action" : "common.save",
        )}
        cancelText={t("common.cancel")}
        cancelButtonProps={{ disabled: saveMutation.isPending }}
        confirmLoading={saveMutation.isPending}
        onCancel={closeEditor}
        onOk={() => form.submit()}
      >
        <Form<DomainFormValues>
          form={form}
          layout="vertical"
          preserve={false}
          onFinish={(values) => void save(values)}
        >
          <Form.Item
            name="domain"
            label={t("fields.domain")}
            extra={t("hubSignupDomains.form.domainHint")}
            rules={[
              { required: true, message: t("validation.required") },
              {
                validator: (_, value: unknown) =>
                  typeof value === "string" && isDomainName(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("validation.domain"))),
              },
            ]}
          >
            <Input
              autoComplete="off"
              placeholder={t("hubSignupDomains.form.domainPlaceholder")}
            />
          </Form.Item>
          <Form.Item
            name="state"
            label={t("fields.state")}
            rules={[{ required: true, message: t("validation.required") }]}
          >
            <Select
              options={[
                { value: "active", label: t("states.active") },
                { value: "disabled", label: t("states.disabled") },
              ]}
            />
          </Form.Item>
          {selectedState === "disabled" ? (
            <Form.Item
              name="disabled_comment"
              label={t("hubSignupDomains.form.disabledCommentLabel")}
              extra={t("hubSignupDomains.form.disabledCommentHint")}
              preserve={false}
              rules={[
                { required: true, message: t("validation.required") },
                {
                  validator: (_, value: unknown) =>
                    typeof value === "string" && isDisableComment(value)
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error(t("validation.disableComment")),
                        ),
                },
              ]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </Space>
  );
}
