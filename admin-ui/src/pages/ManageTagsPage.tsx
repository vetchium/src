import {
	DeleteOutlined,
	EditOutlined,
	PlusOutlined,
	SearchOutlined,
	TagsOutlined,
	UploadOutlined,
} from "@ant-design/icons";
import {
	App,
	Button,
	Card,
	Col,
	Form,
	Image,
	Input,
	Modal,
	Popconfirm,
	Row,
	Space,
	Spin,
	Table,
	Typography,
	Upload,
} from "antd";
import type { UploadFile } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AdminTag,
	CreateTagRequest,
	FilterTagsRequest,
	TagTranslation,
	UpdateTagRequest,
	DeleteTagIconRequest,
} from "vetchium-specs/admin/tags";
import {
	validateCreateTagRequest,
	validateUpdateTagRequest,
} from "vetchium-specs/admin/tags";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Title, Text } = Typography;
const { TextArea } = Input;

const SUPPORTED_LOCALES = ["en-US", "de-DE", "ta-IN"];

export function ManageTagsPage() {
	const { t } = useTranslation("tags");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [tags, setTags] = useState<AdminTag[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [paginationKey, setPaginationKey] = useState<string | undefined>(
		undefined
	);
	const [hasMore, setHasMore] = useState(false);

	// Add tag modal
	const [addModalVisible, setAddModalVisible] = useState(false);
	const [addLoading, setAddLoading] = useState(false);
	const [addForm] = Form.useForm();

	// Edit tag modal
	const [editModalVisible, setEditModalVisible] = useState(false);
	const [editLoading, setEditLoading] = useState(false);
	const [editForm] = Form.useForm();
	const [editingTagId, setEditingTagId] = useState<string | null>(null);

	// Icon upload modal
	const [iconModalVisible, setIconModalVisible] = useState(false);
	const [iconLoading, setIconLoading] = useState(false);
	const [iconTagId, setIconTagId] = useState<string | null>(null);
	const [iconSize, setIconSize] = useState<"small" | "large">("small");
	const [iconFileList, setIconFileList] = useState<UploadFile[]>([]);

	const fetchTags = useCallback(
		async (query: string, cursor?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const reqBody: FilterTagsRequest = {
					query: query || undefined,
					pagination_key: cursor || undefined,
				};
				const resp = await fetch(`${apiBaseUrl}/admin/filter-tags`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (cursor) {
						setTags((prev) => [...prev, ...data.tags]);
					} else {
						setTags(data.tags ?? []);
					}
					setHasMore(!!data.pagination_key);
					setPaginationKey(data.pagination_key || undefined);
				} else {
					message.error(t("common:serverError"));
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		fetchTags(searchQuery);
	}, [fetchTags, searchQuery]);

	const handleSearch = (val: string) => {
		setSearchQuery(val);
		setPaginationKey(undefined);
	};

	const handleLoadMore = () => {
		fetchTags(searchQuery, paginationKey);
	};

	const handleAddTag = async () => {
		const values = addForm.getFieldsValue();
		const translations: TagTranslation[] = (values.translations ?? []).map(
			(t: { locale: string; display_name: string; description?: string }) => ({
				locale: t.locale,
				display_name: t.display_name,
				description: t.description || undefined,
			})
		);

		const req: CreateTagRequest = {
			tag_id: values.tag_id,
			translations,
		};

		const errs = validateCreateTagRequest(req);
		if (errs.length > 0) {
			message.error(errs[0].message);
			return;
		}

		setAddLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const resp = await fetch(`${apiBaseUrl}/admin/add-tag`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 201) {
				message.success(t("tagCreated"));
				setAddModalVisible(false);
				addForm.resetFields();
				fetchTags(searchQuery);
			} else if (resp.status === 409) {
				message.error(t("common:conflict"));
			} else if (resp.status === 400) {
				const body = await resp.json();
				message.error(
					Array.isArray(body) ? body[0]?.message : t("common:badRequest")
				);
			} else {
				message.error(t("common:serverError"));
			}
		} finally {
			setAddLoading(false);
		}
	};

	const handleEditTag = async () => {
		if (!editingTagId) return;
		const values = editForm.getFieldsValue();
		const translations: TagTranslation[] = (values.translations ?? []).map(
			(t: { locale: string; display_name: string; description?: string }) => ({
				locale: t.locale,
				display_name: t.display_name,
				description: t.description || undefined,
			})
		);

		const req: UpdateTagRequest = {
			tag_id: editingTagId,
			translations,
		};

		const errs = validateUpdateTagRequest(req);
		if (errs.length > 0) {
			message.error(errs[0].message);
			return;
		}

		setEditLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const resp = await fetch(`${apiBaseUrl}/admin/update-tag`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("tagUpdated"));
				setEditModalVisible(false);
				editForm.resetFields();
				setEditingTagId(null);
				fetchTags(searchQuery);
			} else if (resp.status === 404) {
				message.error(t("common:notFound"));
			} else if (resp.status === 400) {
				const body = await resp.json();
				message.error(
					Array.isArray(body) ? body[0]?.message : t("common:badRequest")
				);
			} else {
				message.error(t("common:serverError"));
			}
		} finally {
			setEditLoading(false);
		}
	};

	const openEditModal = (tag: AdminTag) => {
		setEditingTagId(tag.tag_id);
		editForm.setFieldsValue({
			translations: tag.translations.map((tr) => ({
				locale: tr.locale,
				display_name: tr.display_name,
				description: tr.description,
			})),
		});
		setEditModalVisible(true);
	};

	const openIconModal = (tagId: string, size: "small" | "large") => {
		setIconTagId(tagId);
		setIconSize(size);
		setIconFileList([]);
		setIconModalVisible(true);
	};

	const handleUploadIcon = async () => {
		if (!iconTagId || iconFileList.length === 0) return;
		setIconLoading(true);
		try {
			const formData = new FormData();
			formData.append("tag_id", iconTagId);
			formData.append("icon_size", iconSize);
			const file = iconFileList[0].originFileObj;
			if (!file) return;
			formData.append("icon_file", file);

			const apiBaseUrl = await getApiBaseUrl();
			const resp = await fetch(`${apiBaseUrl}/admin/upload-tag-icon`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${sessionToken}`,
				},
				body: formData,
			});
			if (resp.status === 200) {
				message.success(t("iconUploaded"));
				setIconModalVisible(false);
				fetchTags(searchQuery);
			} else if (resp.status === 404) {
				message.error(t("common:notFound"));
			} else if (resp.status === 400) {
				const body = await resp.text();
				message.error(body || t("common:badRequest"));
			} else {
				message.error(t("common:serverError"));
			}
		} finally {
			setIconLoading(false);
		}
	};

	const handleDeleteIcon = async (tagId: string, size: "small" | "large") => {
		const req: DeleteTagIconRequest = {
			tag_id: tagId,
			icon_size: size,
		};
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const resp = await fetch(`${apiBaseUrl}/admin/delete-tag-icon`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("iconDeleted"));
				fetchTags(searchQuery);
			} else if (resp.status === 404) {
				message.error(t("common:notFound"));
			} else {
				message.error(t("common:serverError"));
			}
		} catch {
			message.error(t("common:serverError"));
		}
	};

	const columns = [
		{
			title: t("tagId"),
			dataIndex: "tag_id",
			key: "tag_id",
			render: (tagId: string) => <Text code>{tagId}</Text>,
		},
		{
			title: t("translations"),
			dataIndex: "translations",
			key: "translations",
			render: (translations: TagTranslation[]) => (
				<Space orientation="vertical" size="small">
					{translations.map((tr) => (
						<Text key={tr.locale}>
							<Text type="secondary">[{tr.locale}]</Text> {tr.display_name}
						</Text>
					))}
				</Space>
			),
		},
		{
			title: t("smallIcon"),
			key: "small_icon",
			render: (_: unknown, tag: AdminTag) =>
				tag.small_icon_url ? (
					<Space>
						<Image src={tag.small_icon_url} width={32} height={32} />
						<Popconfirm
							title={t("confirmDeleteIcon")}
							onConfirm={() => handleDeleteIcon(tag.tag_id, "small")}
							okText={t("deleteIconConfirm")}
							cancelText={t("cancel")}
						>
							<Button size="small" danger icon={<DeleteOutlined />} />
						</Popconfirm>
					</Space>
				) : (
					<Button
						size="small"
						icon={<UploadOutlined />}
						onClick={() => openIconModal(tag.tag_id, "small")}
					>
						{t("uploadIcon")}
					</Button>
				),
		},
		{
			title: t("largeIcon"),
			key: "large_icon",
			render: (_: unknown, tag: AdminTag) =>
				tag.large_icon_url ? (
					<Space>
						<Image src={tag.large_icon_url} width={48} height={48} />
						<Popconfirm
							title={t("confirmDeleteIcon")}
							onConfirm={() => handleDeleteIcon(tag.tag_id, "large")}
							okText={t("deleteIconConfirm")}
							cancelText={t("cancel")}
						>
							<Button size="small" danger icon={<DeleteOutlined />} />
						</Popconfirm>
					</Space>
				) : (
					<Button
						size="small"
						icon={<UploadOutlined />}
						onClick={() => openIconModal(tag.tag_id, "large")}
					>
						{t("uploadIcon")}
					</Button>
				),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, tag: AdminTag) => (
				<Button
					icon={<EditOutlined />}
					onClick={() => openEditModal(tag)}
					size="small"
				>
					{t("editTag")}
				</Button>
			),
		},
	];

	return (
		<div style={{ width: "100%", maxWidth: 1200 }}>
			<Card>
				<Space
					style={{
						width: "100%",
						justifyContent: "space-between",
						marginBottom: 16,
					}}
					align="center"
				>
					<Space>
						<Link to="/">
							<Button>← {t("common:back")}</Button>
						</Link>
						<Title level={4} style={{ margin: 0 }}>
							<TagsOutlined /> {t("pageTitle")}
						</Title>
					</Space>
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setAddModalVisible(true)}
					>
						{t("addTag")}
					</Button>
				</Space>

				<Row style={{ marginBottom: 16 }}>
					<Col span={12}>
						<Input.Search
							placeholder={t("searchPlaceholder")}
							onSearch={handleSearch}
							allowClear
							prefix={<SearchOutlined />}
						/>
					</Col>
				</Row>

				<Spin spinning={loading}>
					<Table
						dataSource={tags}
						columns={columns}
						rowKey="tag_id"
						pagination={false}
						locale={{ emptyText: t("noTags") }}
					/>
				</Spin>

				{hasMore && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button onClick={handleLoadMore} loading={loading}>
							{t("loadMore")}
						</Button>
					</div>
				)}
			</Card>

			{/* Add Tag Modal */}
			<Modal
				title={t("addTag")}
				open={addModalVisible}
				onCancel={() => {
					setAddModalVisible(false);
					addForm.resetFields();
				}}
				onOk={handleAddTag}
				confirmLoading={addLoading}
				okText={t("save")}
				cancelText={t("cancel")}
				width={700}
			>
				<Spin spinning={addLoading}>
					<Form form={addForm} layout="vertical">
						<Form.Item
							name="tag_id"
							label={t("tagId")}
							help={t("tagIdHelp")}
							required
						>
							<Input placeholder={t("tagIdPlaceholder")} />
						</Form.Item>

						<Form.List
							name="translations"
							initialValue={[{ locale: "en-US", display_name: "" }]}
						>
							{(fields, { add, remove }) => (
								<>
									{fields.map(({ key, name }) => (
										<Row key={key} gutter={8} align="middle">
											<Col span={6}>
												<Form.Item
													name={[name, "locale"]}
													label={key === 0 ? t("locale") : undefined}
												>
													<Input placeholder="en-US" />
												</Form.Item>
											</Col>
											<Col span={10}>
												<Form.Item
													name={[name, "display_name"]}
													label={key === 0 ? t("displayName") : undefined}
												>
													<Input />
												</Form.Item>
											</Col>
											<Col span={6}>
												<Form.Item
													name={[name, "description"]}
													label={key === 0 ? t("description") : undefined}
												>
													<TextArea rows={1} />
												</Form.Item>
											</Col>
											<Col span={2}>
												{fields.length > 1 && (
													<Button
														danger
														size="small"
														onClick={() => remove(name)}
														style={{ marginTop: key === 0 ? 30 : 0 }}
													>
														✕
													</Button>
												)}
											</Col>
										</Row>
									))}
									<Button
										type="dashed"
										onClick={() => add({ locale: "", display_name: "" })}
										icon={<PlusOutlined />}
									>
										{t("addTranslation")}
									</Button>
								</>
							)}
						</Form.List>
					</Form>
				</Spin>
			</Modal>

			{/* Edit Tag Modal */}
			<Modal
				title={`${t("editTag")}: ${editingTagId}`}
				open={editModalVisible}
				onCancel={() => {
					setEditModalVisible(false);
					editForm.resetFields();
					setEditingTagId(null);
				}}
				onOk={handleEditTag}
				confirmLoading={editLoading}
				okText={t("save")}
				cancelText={t("cancel")}
				width={700}
			>
				<Spin spinning={editLoading}>
					<Form form={editForm} layout="vertical">
						<Form.List name="translations">
							{(fields, { add, remove }) => (
								<>
									{fields.map(({ key, name }) => (
										<Row key={key} gutter={8} align="middle">
											<Col span={6}>
												<Form.Item
													name={[name, "locale"]}
													label={key === 0 ? t("locale") : undefined}
												>
													<Input placeholder="en-US" />
												</Form.Item>
											</Col>
											<Col span={10}>
												<Form.Item
													name={[name, "display_name"]}
													label={key === 0 ? t("displayName") : undefined}
												>
													<Input />
												</Form.Item>
											</Col>
											<Col span={6}>
												<Form.Item
													name={[name, "description"]}
													label={key === 0 ? t("description") : undefined}
												>
													<TextArea rows={1} />
												</Form.Item>
											</Col>
											<Col span={2}>
												{fields.length > 1 && (
													<Button
														danger
														size="small"
														onClick={() => remove(name)}
														style={{ marginTop: key === 0 ? 30 : 0 }}
													>
														✕
													</Button>
												)}
											</Col>
										</Row>
									))}
									<Button
										type="dashed"
										onClick={() => add({ locale: "", display_name: "" })}
										icon={<PlusOutlined />}
									>
										{t("addTranslation")}
									</Button>
								</>
							)}
						</Form.List>
					</Form>
				</Spin>
			</Modal>

			{/* Icon Upload Modal */}
			<Modal
				title={`${t("uploadIcon")} (${iconSize})`}
				open={iconModalVisible}
				onCancel={() => {
					setIconModalVisible(false);
					setIconFileList([]);
				}}
				onOk={handleUploadIcon}
				confirmLoading={iconLoading}
				okText={t("uploadIcon")}
				cancelText={t("cancel")}
			>
				<Spin spinning={iconLoading}>
					<Upload
						fileList={iconFileList}
						beforeUpload={(file) => {
							setIconFileList([file as unknown as UploadFile]);
							return false;
						}}
						onRemove={() => setIconFileList([])}
						accept="image/png,image/jpeg,image/webp,image/svg+xml"
						maxCount={1}
					>
						<Button icon={<UploadOutlined />}>{t("uploadIcon")}</Button>
					</Upload>
					<Text type="secondary" style={{ marginTop: 8, display: "block" }}>
						PNG, JPEG, WebP, SVG · max 5MB
					</Text>
				</Spin>
			</Modal>
		</div>
	);
}

// Silence unused import warning for SUPPORTED_LOCALES
void SUPPORTED_LOCALES;
