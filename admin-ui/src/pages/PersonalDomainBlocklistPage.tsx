import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Form,
	Input,
	Modal,
	Spin,
	Table,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AdminListBlockedDomainsRequest,
	BlockedPersonalDomain,
} from "vetchium-specs/admin/personal-domain-blocklist";
import { validateAdminAddBlockedDomainRequest } from "vetchium-specs/admin/personal-domain-blocklist";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";
import { formatDateTime } from "../utils/dateFormat";

const { Title } = Typography;

export function PersonalDomainBlocklistPage() {
	const { t, i18n } = useTranslation("personalDomainBlocklist");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [domains, setDomains] = useState<BlockedPersonalDomain[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>();
	const [filterPrefix, setFilterPrefix] = useState<string>("");

	const [addModalVisible, setAddModalVisible] = useState(false);
	const [adding, setAdding] = useState(false);
	const [addFormValid, setAddFormValid] = useState(false);
	const [form] = Form.useForm();

	const fetchDomains = useCallback(
		async (paginationKey?: string, prefix?: string) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: AdminListBlockedDomainsRequest = {
					limit: 50,
				};
				const effectivePrefix =
					prefix !== undefined ? prefix : filterPrefix;
				if (effectivePrefix) req.filter_domain_prefix = effectivePrefix;
				if (paginationKey) req.pagination_key = paginationKey;

				const response = await fetch(
					`${apiBaseUrl}/admin/list-blocked-personal-domains`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(req),
					}
				);

				if (response.status === 401) {
					message.error(t("errors.loadFailed"));
					return;
				}

				if (response.status !== 200) {
					throw new Error(`HTTP ${response.status}`);
				}

				const data = await response.json();
				if (paginationKey) {
					setDomains((prev) => [...prev, ...data.domains]);
				} else {
					setDomains(data.domains);
				}
				setNextPaginationKey(data.next_pagination_key);
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, filterPrefix, t, message]
	);

	useEffect(() => {
		fetchDomains();
	}, [fetchDomains]);

	const handleAdd = async () => {
		try {
			const values = await form.validateFields();
			const domain = values.domain.trim().toLowerCase();

			const validationErrors = validateAdminAddBlockedDomainRequest({
				domain,
			});
			if (validationErrors.length > 0) {
				message.error(
					validationErrors.map((e) => `${e.field}: ${e.message}`).join(", ")
				);
				return;
			}

			setAdding(true);
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/admin/add-blocked-personal-domain`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ domain }),
				}
			);

			if (response.status === 409) {
				message.error(t("errors.exists"));
				return;
			}
			if (response.status === 400) {
				const errs = await response.json().catch(() => []);
				if (Array.isArray(errs) && errs.length > 0) {
					message.error(
						errs.map((e: { field: string; message: string }) => e.message).join(", ")
					);
				} else {
					message.error(t("errors.addFailed"));
				}
				return;
			}
			if (response.status === 401 || response.status === 403) {
				message.error(t("errors.addFailed"));
				return;
			}
			if (response.status === 201) {
				message.success(t("success.added"));
				setAddModalVisible(false);
				form.resetFields();
				setAddFormValid(false);
				setNextPaginationKey(undefined);
				fetchDomains(undefined, filterPrefix);
			}
		} catch {
			message.error(t("errors.addFailed"));
		} finally {
			setAdding(false);
		}
	};

	const handleRemove = async (domain: string) => {
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/admin/remove-blocked-personal-domain`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ domain }),
				}
			);

			if (response.status === 404) {
				message.error(t("errors.removeFailed"));
				return;
			}
			if (response.status === 204) {
				message.success(t("success.removed"));
				setNextPaginationKey(undefined);
				fetchDomains(undefined, filterPrefix);
			}
		} catch {
			message.error(t("errors.removeFailed"));
		}
	};

	const handleFilterChange = (value: string) => {
		setFilterPrefix(value);
		setNextPaginationKey(undefined);
		fetchDomains(undefined, value);
	};

	const columns = [
		{
			title: t("domain"),
			dataIndex: "domain",
			key: "domain",
		},
		{
			title: t("createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (date: string) => formatDateTime(date, i18n.language),
		},
		{
			title: "",
			key: "actions",
			render: (_: unknown, record: BlockedPersonalDomain) => (
				<Button
					danger
					icon={<DeleteOutlined />}
					onClick={() => {
						Modal.confirm({
							title: t("removeConfirm"),
							onOk: () => handleRemove(record.domain),
						});
					}}
				>
					{t("removeConfirm").split("?")[0]}
				</Button>
			),
		},
	];

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("title")}
				</Title>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					onClick={() => {
						form.resetFields();
						setAddFormValid(false);
						setAddModalVisible(true);
					}}
				>
					{t("addDomain")}
				</Button>
			</div>

			<Input
				placeholder={t("domain")}
				value={filterPrefix}
				onChange={(e) => handleFilterChange(e.target.value)}
				allowClear
				style={{ marginBottom: 16, maxWidth: 400 }}
			/>

			<Spin spinning={loading}>
				<Table
					dataSource={domains}
					columns={columns}
					rowKey="domain"
					pagination={false}
				/>
				{nextPaginationKey && !loading && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button onClick={() => fetchDomains(nextPaginationKey)}>
							Load more
						</Button>
					</div>
				)}
			</Spin>

			<Modal
				title={t("addModal.title")}
				open={addModalVisible}
				onOk={handleAdd}
				onCancel={() => {
					setAddModalVisible(false);
					form.resetFields();
					setAddFormValid(false);
				}}
				confirmLoading={adding}
				okText={t("addModal.submit")}
				okButtonProps={{ disabled: !addFormValid }}
			>
				<Spin spinning={adding}>
					<Form
						form={form}
						layout="vertical"
						onFieldsChange={() => {
							const hasErrors = form
								.getFieldsError()
								.some(({ errors }) => errors.length > 0);
							const touched = form.isFieldsTouched(["domain"], true);
							setAddFormValid(touched && !hasErrors);
						}}
					>
						<Form.Item
							name="domain"
							label={t("domain")}
							rules={[
								{ required: true, message: `${t("domain")} is required` },
								{
									max: 253,
									message: `${t("domain")} must be at most 253 characters`,
								},
								{
									validator: (_, value) => {
										if (value && value.includes("@")) {
											return Promise.reject(`${t("domain")} must not contain @`);
										}
										return Promise.resolve();
									},
								},
							]}
						>
							<Input placeholder="example.com" />
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
