import { useState, useEffect, useCallback } from "react";
import {
	Card,
	Table,
	Button,
	Input,
	Modal,
	message,
	Space,
	Typography,
	Tag,
	Form,
	Spin,
	Empty,
	Popconfirm,
	Tooltip,
	Drawer,
	Descriptions,
} from "antd";
import {
	PlusOutlined,
	SearchOutlined,
	ArrowLeftOutlined,
	DeleteOutlined,
	InfoCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { getApiBaseUrl } from "../config";
import type {
	CreateApprovedDomainRequest,
	ApprovedDomain,
	ApprovedDomainListResponse,
	ApprovedDomainDetailResponse,
	ApprovedDomainAuditLog,
} from "vetchium-specs/admin/approved-domains";
import { validateCreateApprovedDomainRequest } from "vetchium-specs/admin/approved-domains";

const { Title } = Typography;

interface ApprovedDomainsPageProps {
	onBack: () => void;
}

export function ApprovedDomainsPage({ onBack }: ApprovedDomainsPageProps) {
	const { t } = useTranslation("approvedDomains");
	const { sessionToken } = useAuth();

	const [domains, setDomains] = useState<ApprovedDomain[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);

	const [addModalVisible, setAddModalVisible] = useState(false);
	const [addingDomain, setAddingDomain] = useState(false);
	const [form] = Form.useForm();

	const [detailDrawerVisible, setDetailDrawerVisible] = useState(false);
	const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
	const [domainDetail, setDomainDetail] =
		useState<ApprovedDomainDetailResponse | null>(null);
	const [loadingDetail, setLoadingDetail] = useState(false);

	const fetchDomains = useCallback(
		async (cursor: string | null = null, query: string = searchQuery) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const params = new URLSearchParams();
				params.append("limit", "50");
				if (cursor) params.append("cursor", cursor);
				if (query) params.append("query", query);

				const response = await fetch(
					`${apiBaseUrl}/admin/approved-domains?${params.toString()}`,
					{
						headers: {
							Authorization: `Bearer ${sessionToken}`,
						},
					}
				);

				if (response.status === 401) {
					message.error(t("errors.unauthorized"));
					return;
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data: ApprovedDomainListResponse = await response.json();

				if (cursor === null) {
					setDomains(data.domains);
				} else {
					setDomains((prev) => [...prev, ...data.domains]);
				}

				setNextCursor(data.next_cursor);
				setHasMore(data.has_more);
			} catch (err) {
				console.error("Failed to fetch approved domains:", err);
				message.error(t("errors.fetchFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, searchQuery, t]
	);

	useEffect(() => {
		fetchDomains(null, "");
	}, [fetchDomains]);

	const handleSearch = (value: string) => {
		setSearchQuery(value);
		setNextCursor(null);
		fetchDomains(null, value);
	};

	const handleLoadMore = () => {
		if (nextCursor && hasMore && !loading) {
			fetchDomains(nextCursor, searchQuery);
		}
	};

	const handleAddDomain = async () => {
		try {
			const values = await form.validateFields();
			const request: CreateApprovedDomainRequest = {
				domain_name: values.domain_name,
			};

			const validationErrors = validateCreateApprovedDomainRequest(request);
			if (validationErrors.length > 0) {
				const errorMsg = validationErrors
					.map((e) => `${e.field}: ${e.message}`)
					.join(", ");
				message.error(errorMsg);
				return;
			}

			setAddingDomain(true);
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/approved-domains`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 400) {
				const errors: unknown = await response.json();
				if (Array.isArray(errors)) {
					const errorMsg = errors
						.map(
							(e: { field: string; message: string }) =>
								`${e.field}: ${e.message}`
						)
						.join(", ");
					message.error(errorMsg);
				} else {
					message.error(t("errors.invalidRequest"));
				}
				return;
			}

			if (response.status === 401) {
				message.error(t("errors.unauthorized"));
				return;
			}

			if (response.status === 409) {
				message.error(t("errors.domainExists"));
				return;
			}

			if (response.status === 201) {
				message.success(t("success.added"));
				setAddModalVisible(false);
				form.resetFields();
				setSearchQuery("");
				setNextCursor(null);
				fetchDomains(null, "");
			}
		} catch (err) {
			console.error("Failed to add domain:", err);
			message.error(t("errors.addFailed"));
		} finally {
			setAddingDomain(false);
		}
	};

	const handleDeleteDomain = async (domainName: string) => {
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/admin/approved-domains/${encodeURIComponent(domainName)}`,
				{
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${sessionToken}`,
					},
				}
			);

			if (response.status === 401) {
				message.error(t("errors.unauthorized"));
				return;
			}

			if (response.status === 404) {
				message.error(t("errors.domainNotFound"));
				return;
			}

			if (response.status === 204) {
				message.success(t("success.deleted"));
				setSearchQuery("");
				setNextCursor(null);
				fetchDomains(null, "");
			}
		} catch (err) {
			console.error("Failed to delete domain:", err);
			message.error(t("errors.deleteFailed"));
		}
	};

	const showDomainDetail = async (domainName: string) => {
		setSelectedDomain(domainName);
		setDetailDrawerVisible(true);
		setLoadingDetail(true);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/admin/approved-domains/${encodeURIComponent(domainName)}`,
				{
					headers: {
						Authorization: `Bearer ${sessionToken}`,
					},
				}
			);

			if (response.status === 401) {
				message.error(t("errors.unauthorized"));
				setDetailDrawerVisible(false);
				return;
			}

			if (response.status === 404) {
				message.error(t("errors.domainNotFound"));
				setDetailDrawerVisible(false);
				return;
			}

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: ApprovedDomainDetailResponse = await response.json();
			setDomainDetail(data);
		} catch (err) {
			console.error("Failed to fetch domain detail:", err);
			message.error(t("errors.fetchDetailFailed"));
			setDetailDrawerVisible(false);
		} finally {
			setLoadingDetail(false);
		}
	};

	const columns = [
		{
			title: t("table.domainName"),
			dataIndex: "domain_name",
			key: "domain_name",
			render: (domainName: string) => (
				<Space>
					<span>{domainName}</span>
					<Tooltip title={t("actions.viewDetails")}>
						<Button
							type="link"
							size="small"
							icon={<InfoCircleOutlined />}
							onClick={() => showDomainDetail(domainName)}
						/>
					</Tooltip>
				</Space>
			),
		},
		{
			title: t("table.createdBy"),
			dataIndex: "created_by_admin_email",
			key: "created_by_admin_email",
		},
		{
			title: t("table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (date: string) => new Date(date).toLocaleString(),
		},
		{
			title: t("table.actions"),
			key: "actions",
			render: (_: unknown, record: ApprovedDomain) => (
				<Popconfirm
					title={t("confirmDelete.title")}
					description={t("confirmDelete.message", {
						domain: record.domain_name,
					})}
					onConfirm={() => handleDeleteDomain(record.domain_name)}
					okText={t("confirmDelete.confirm")}
					cancelText={t("confirmDelete.cancel")}
				>
					<Button danger icon={<DeleteOutlined />}>
						{t("actions.delete")}
					</Button>
				</Popconfirm>
			),
		},
	];

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 24,
				width: "100%",
				maxWidth: 1200,
				margin: "0 auto",
			}}
		>
			<Card style={{ width: "100%", textAlign: "center" }}>
				<Title level={3}>{t("title")}</Title>
			</Card>

			<Card style={{ width: "100%" }}>
				<Space direction="vertical" size="large" style={{ width: "100%" }}>
					<Space style={{ justifyContent: "space-between", width: "100%" }}>
						<Button icon={<ArrowLeftOutlined />} onClick={onBack}>
							{t("actions.back")}
						</Button>
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={() => setAddModalVisible(true)}
						>
							{t("actions.add")}
						</Button>
					</Space>

					<Input
						prefix={<SearchOutlined />}
						placeholder={t("search.placeholder")}
						value={searchQuery}
						onChange={(e) => handleSearch(e.target.value)}
						allowClear
					/>

					<Spin spinning={loading}>
						<Table
							dataSource={domains}
							columns={columns}
							rowKey="domain_name"
							pagination={false}
							locale={{
								emptyText: <Empty description={t("table.empty")} />,
							}}
						/>
						{hasMore && !loading && (
							<div style={{ textAlign: "center", marginTop: 16 }}>
								<Button onClick={handleLoadMore}>
									{t("actions.loadMore")}
								</Button>
							</div>
						)}
					</Spin>
				</Space>
			</Card>

			<Modal
				title={t("addModal.title")}
				open={addModalVisible}
				onOk={handleAddDomain}
				onCancel={() => {
					setAddModalVisible(false);
					form.resetFields();
				}}
				confirmLoading={addingDomain}
				okText={t("addModal.confirm")}
				cancelText={t("addModal.cancel")}
			>
				<Form form={form} layout="vertical">
					<Form.Item
						name="domain_name"
						label={t("addModal.domainLabel")}
						rules={[
							{ required: true, message: t("addModal.domainRequired") },
							{
								pattern: /^[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i,
								message: t("addModal.domainInvalid"),
							},
						]}
					>
						<Input placeholder={t("addModal.domainPlaceholder")} />
					</Form.Item>
				</Form>
			</Modal>

			<Drawer
				title={t("detailDrawer.title", { domain: selectedDomain })}
				open={detailDrawerVisible}
				onClose={() => {
					setDetailDrawerVisible(false);
					setDomainDetail(null);
				}}
				width={600}
			>
				<Spin spinning={loadingDetail}>
					{domainDetail && (
						<Space direction="vertical" size="large" style={{ width: "100%" }}>
							<div>
								<Title level={5}>{t("detailDrawer.domainInfo")}</Title>
								<Descriptions bordered column={1}>
									<Descriptions.Item label={t("detailDrawer.domainName")}>
										{domainDetail.domain.domain_name}
									</Descriptions.Item>
									<Descriptions.Item label={t("detailDrawer.createdBy")}>
										{domainDetail.domain.created_by_admin_email}
									</Descriptions.Item>
									<Descriptions.Item label={t("detailDrawer.createdAt")}>
										{new Date(domainDetail.domain.created_at).toLocaleString()}
									</Descriptions.Item>
									<Descriptions.Item label={t("detailDrawer.updatedAt")}>
										{new Date(domainDetail.domain.updated_at).toLocaleString()}
									</Descriptions.Item>
								</Descriptions>
							</div>

							<div>
								<Title level={5}>{t("detailDrawer.auditLogs")}</Title>
								{domainDetail.audit_logs.length === 0 ? (
									<Empty description={t("detailDrawer.noAuditLogs")} />
								) : (
									domainDetail.audit_logs.map(
										(log: ApprovedDomainAuditLog, index: number) => (
											<Card
												key={index}
												size="small"
												style={{ marginBottom: 8 }}
											>
												<Space
													direction="vertical"
													size="small"
													style={{ width: "100%" }}
												>
													<Space>
														<Tag
															color={log.action === "created" ? "green" : "red"}
														>
															{t(`auditActions.${log.action}`)}
														</Tag>
														<span style={{ fontSize: 12, color: "#888" }}>
															{new Date(log.created_at).toLocaleString()}
														</span>
													</Space>
													<div>
														<strong>{t("detailDrawer.admin")}:</strong>{" "}
														{log.admin_email}
													</div>
													{log.target_domain_name && (
														<div>
															<strong>{t("detailDrawer.targetDomain")}:</strong>{" "}
															{log.target_domain_name}
														</div>
													)}
													{log.ip_address && (
														<div>
															<strong>{t("detailDrawer.ipAddress")}:</strong>{" "}
															{log.ip_address}
														</div>
													)}
												</Space>
											</Card>
										)
									)
								)}
								{domainDetail.has_more_audit && (
									<div style={{ textAlign: "center", marginTop: 8 }}>
										<Tooltip title={t("detailDrawer.moreAuditLogsHint")}>
											<Tag color="blue">{t("detailDrawer.moreAuditLogs")}</Tag>
										</Tooltip>
									</div>
								)}
							</div>
						</Space>
					)}
				</Spin>
			</Drawer>
		</div>
	);
}
