import {
	ArrowLeftOutlined,
	CheckCircleOutlined,
	InfoCircleOutlined,
	PlusOutlined,
	SearchOutlined,
	StopOutlined,
} from "@ant-design/icons";
import {
	Button,
	Card,
	Descriptions,
	Drawer,
	Empty,
	Form,
	Input,
	message,
	Modal,
	Space,
	Spin,
	Table,
	Tabs,
	Tag,
	Tooltip,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AddApprovedDomainRequest,
	ApprovedDomain,
	ApprovedDomainAuditLog,
	ApprovedDomainDetailResponse,
	ApprovedDomainListResponse,
	DomainFilter,
	GetApprovedDomainRequest,
	ListApprovedDomainsRequest,
} from "vetchium-specs/admin/approved-domains";
import {
	validateAddApprovedDomainRequest,
	validateDisableApprovedDomainRequest,
	validateEnableApprovedDomainRequest,
} from "vetchium-specs/admin/approved-domains";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../contexts/AuthContext";

const { Title } = Typography;
const { TextArea } = Input;

export function ApprovedDomainsPage() {
	const { t } = useTranslation("approvedDomains");
	const { sessionToken } = useAuth();

	const [domains, setDomains] = useState<ApprovedDomain[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [filter, setFilter] = useState<DomainFilter>("active");

	const [addModalVisible, setAddModalVisible] = useState(false);
	const [addingDomain, setAddingDomain] = useState(false);
	const [form] = Form.useForm();

	const [disableModalVisible, setDisableModalVisible] = useState(false);
	const [disablingDomain, setDisablingDomain] = useState(false);
	const [domainToDisable, setDomainToDisable] = useState<string | null>(null);
	const [disableForm] = Form.useForm();

	const [enableModalVisible, setEnableModalVisible] = useState(false);
	const [enablingDomain, setEnablingDomain] = useState(false);
	const [domainToEnable, setDomainToEnable] = useState<string | null>(null);
	const [enableForm] = Form.useForm();

	const [detailDrawerVisible, setDetailDrawerVisible] = useState(false);
	const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
	const [domainDetail, setDomainDetail] =
		useState<ApprovedDomainDetailResponse | null>(null);
	const [loadingDetail, setLoadingDetail] = useState(false);
	const [loadingMoreAuditLogs, setLoadingMoreAuditLogs] = useState(false);

	const fetchDomains = useCallback(
		async (
			cursor: string | null = null,
			query: string = searchQuery,
			currentFilter: DomainFilter = filter
		) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const requestBody: ListApprovedDomainsRequest = {
					limit: 50,
					filter: currentFilter,
				};

				if (cursor) requestBody.cursor = cursor;
				if (query) requestBody.search = query;

				const response = await fetch(
					`${apiBaseUrl}/admin/list-approved-domains`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(requestBody),
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
		[sessionToken, searchQuery, filter, t]
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
			const request: AddApprovedDomainRequest = {
				domain_name: values.domain_name,
				reason: values.reason,
			};

			const validationErrors = validateAddApprovedDomainRequest(request);
			if (validationErrors.length > 0) {
				const errorMsg = validationErrors
					.map((e: {field: string; message: string}) => `${e.field}: ${e.message}`)
					.join(", ");
				message.error(errorMsg);
				return;
			}

			setAddingDomain(true);
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/add-approved-domain`, {
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
				fetchDomains(null, "", filter);
			}
		} catch (err) {
			console.error("Failed to add domain:", err);
			message.error(t("errors.addFailed"));
		} finally {
			setAddingDomain(false);
		}
	};

	const handleDisableDomain = async () => {
		if (!domainToDisable) return;

		try {
			const values = await disableForm.validateFields();
			const request = {
				domain_name: domainToDisable,
				reason: values.reason,
			};

			const validationErrors = validateDisableApprovedDomainRequest(request);
			if (validationErrors.length > 0) {
				const errorMsg = validationErrors
					.map((e) => `${e.field}: ${e.message}`)
					.join(", ");
				message.error(errorMsg);
				return;
			}

			setDisablingDomain(true);
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/admin/disable-approved-domain`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(request),
				}
			);

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

			if (response.status === 404) {
				message.error(t("errors.domainNotFound"));
				return;
			}

			if (response.status === 422) {
				message.error(t("errors.domainAlreadyInactive"));
				return;
			}

			if (response.status === 200) {
				message.success(t("success.disabled"));
				setDisableModalVisible(false);
				setDomainToDisable(null);
				disableForm.resetFields();
				setSearchQuery("");
				setNextCursor(null);
				fetchDomains(null, "", filter);
			}
		} catch (err) {
			console.error("Failed to disable domain:", err);
			message.error(t("errors.disableFailed"));
		} finally {
			setDisablingDomain(false);
		}
	};

	const handleEnableDomain = async () => {
		if (!domainToEnable) return;

		try {
			const values = await enableForm.validateFields();
			const request = {
				domain_name: domainToEnable,
				reason: values.reason,
			};

			const validationErrors = validateEnableApprovedDomainRequest(request);
			if (validationErrors.length > 0) {
				const errorMsg = validationErrors
					.map((e) => `${e.field}: ${e.message}`)
					.join(", ");
				message.error(errorMsg);
				return;
			}

			setEnablingDomain(true);
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/admin/enable-approved-domain`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(request),
				}
			);

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

			if (response.status === 404) {
				message.error(t("errors.domainNotFound"));
				return;
			}

			if (response.status === 422) {
				message.error(t("errors.domainAlreadyActive"));
				return;
			}

			if (response.status === 200) {
				message.success(t("success.enabled"));
				setEnableModalVisible(false);
				setDomainToEnable(null);
				enableForm.resetFields();
				setSearchQuery("");
				setNextCursor(null);
				fetchDomains(null, "", filter);
			}
		} catch (err) {
			console.error("Failed to enable domain:", err);
			message.error(t("errors.enableFailed"));
		} finally {
			setEnablingDomain(false);
		}
	};

	const showDomainDetail = async (domainName: string) => {
		setSelectedDomain(domainName);
		setDetailDrawerVisible(true);
		setLoadingDetail(true);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: GetApprovedDomainRequest = {
				domain_name: domainName,
			};
			const response = await fetch(
				`${apiBaseUrl}/admin/get-approved-domain`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(request),
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

	const loadMoreAuditLogs = async () => {
		if (!selectedDomain || !domainDetail?.next_audit_cursor) return;

		setLoadingMoreAuditLogs(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: GetApprovedDomainRequest = {
				domain_name: selectedDomain,
				audit_cursor: domainDetail.next_audit_cursor,
			};
			const response = await fetch(
				`${apiBaseUrl}/admin/get-approved-domain`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(request),
				}
			);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: ApprovedDomainDetailResponse = await response.json();
			setDomainDetail((prev) =>
				prev
					? {
							...prev,
							audit_logs: [...prev.audit_logs, ...data.audit_logs],
							next_audit_cursor: data.next_audit_cursor,
							has_more_audit: data.has_more_audit,
						}
					: null
			);
		} catch (err) {
			console.error("Failed to load more audit logs:", err);
			message.error(t("errors.loadMoreAuditFailed"));
		} finally {
			setLoadingMoreAuditLogs(false);
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
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={status === "active" ? "green" : "red"}>
					{t(`status.${status}`)}
				</Tag>
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
				<Space>
					{record.status === "active" ? (
						<Button
							danger
							icon={<StopOutlined />}
							onClick={() => {
								setDomainToDisable(record.domain_name);
								setDisableModalVisible(true);
							}}
						>
							{t("actions.disable")}
						</Button>
					) : (
						<Button
							type="primary"
							icon={<CheckCircleOutlined />}
							onClick={() => {
								setDomainToEnable(record.domain_name);
								setEnableModalVisible(true);
							}}
						>
							{t("actions.enable")}
						</Button>
					)}
				</Space>
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
						<Link to="/">
							<Button icon={<ArrowLeftOutlined />}>{t("actions.back")}</Button>
						</Link>
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={() => setAddModalVisible(true)}
						>
							{t("actions.add")}
						</Button>
					</Space>

					<Tabs
						activeKey={filter}
						onChange={(key) => {
							setFilter(key as DomainFilter);
							setSearchQuery("");
							setNextCursor(null);
							fetchDomains(null, "", key as DomainFilter);
						}}
						items={[
							{ key: "active", label: t("filters.active") },
							{ key: "inactive", label: t("filters.inactive") },
							{ key: "all", label: t("filters.all") },
						]}
					/>

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
					<Form.Item
						name="reason"
						label={t("addModal.reasonLabel")}
						rules={[
							{ required: true, message: t("addModal.reasonRequired") },
							{
								max: 256,
								message: t("addModal.reasonMaxLength"),
							},
						]}
					>
						<TextArea
							rows={4}
							placeholder={t("addModal.reasonPlaceholder")}
							maxLength={256}
							showCount
						/>
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title={t("disableModal.title")}
				open={disableModalVisible}
				onOk={handleDisableDomain}
				onCancel={() => {
					setDisableModalVisible(false);
					setDomainToDisable(null);
					disableForm.resetFields();
				}}
				confirmLoading={disablingDomain}
				okText={t("disableModal.confirm")}
				cancelText={t("disableModal.cancel")}
				okButtonProps={{ danger: true }}
			>
				<Space direction="vertical" style={{ width: "100%" }}>
					<div>
						{t("disableModal.message", { domain: domainToDisable })}
					</div>
					<Form form={disableForm} layout="vertical">
						<Form.Item
							name="reason"
							label={t("disableModal.reasonLabel")}
							rules={[
								{ required: true, message: t("disableModal.reasonRequired") },
								{
									max: 256,
									message: t("disableModal.reasonMaxLength"),
								},
							]}
						>
							<TextArea
								rows={4}
								placeholder={t("disableModal.reasonPlaceholder")}
								maxLength={256}
								showCount
							/>
						</Form.Item>
					</Form>
				</Space>
			</Modal>

			<Modal
				title={t("enableModal.title")}
				open={enableModalVisible}
				onOk={handleEnableDomain}
				onCancel={() => {
					setEnableModalVisible(false);
					setDomainToEnable(null);
					enableForm.resetFields();
				}}
				confirmLoading={enablingDomain}
				okText={t("enableModal.confirm")}
				cancelText={t("enableModal.cancel")}
			>
				<Space direction="vertical" style={{ width: "100%" }}>
					<div>
						{t("enableModal.message", { domain: domainToEnable })}
					</div>
					<Form form={enableForm} layout="vertical">
						<Form.Item
							name="reason"
							label={t("enableModal.reasonLabel")}
							rules={[
								{ required: true, message: t("enableModal.reasonRequired") },
								{
									max: 256,
									message: t("enableModal.reasonMaxLength"),
								},
							]}
						>
							<TextArea
								rows={4}
								placeholder={t("enableModal.reasonPlaceholder")}
								maxLength={256}
								showCount
							/>
						</Form.Item>
					</Form>
				</Space>
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
									<Descriptions.Item label={t("detailDrawer.status")}>
										<Tag
											color={
												domainDetail.domain.status === "active" ? "green" : "red"
											}
										>
											{t(`status.${domainDetail.domain.status}`)}
										</Tag>
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
															color={
																log.action === "created"
																	? "green"
																	: log.action === "disabled"
																		? "red"
																		: "blue"
															}
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
													{log.reason && (
														<div>
															<strong>{t("detailDrawer.reason")}:</strong> {log.reason}
														</div>
													)}
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
										<Button
											onClick={loadMoreAuditLogs}
											loading={loadingMoreAuditLogs}
										>
											{t("actions.loadMoreAuditLogs")}
										</Button>
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
