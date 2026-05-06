import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import {
	Alert,
	Button,
	Form,
	Input,
	Modal,
	Popconfirm,
	Segmented,
	Spin,
	Table,
	Tag,
	Typography,
	message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	AddWorkEmailRequest,
	AddWorkEmailResponse,
	ListMyWorkEmailsRequest,
	WorkEmailStintOwnerView,
	WorkEmailStintStatus,
} from "vetchium-specs/hub/work-emails";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

type FilterOption = "all" | WorkEmailStintStatus;

export function WorkEmailsListPage() {
	const { t, i18n } = useTranslation("workEmails");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [stints, setStints] = useState<WorkEmailStintOwnerView[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [nextKey, setNextKey] = useState<string | null>(null);
	const [filterOption, setFilterOption] = useState<FilterOption>("all");

	// Add modal state
	const [addModalVisible, setAddModalVisible] = useState(false);
	const [addForm] = Form.useForm();
	const [adding, setAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);

	// Remove state
	const [removingId, setRemovingId] = useState<string | null>(null);

	const fetchStints = useCallback(
		async (
			cursor: string | null = null,
			filter: FilterOption = filterOption
		) => {
			if (!sessionToken) return;
			setLoading(true);
			setLoadError(null);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: ListMyWorkEmailsRequest = { limit: 25 };
				if (cursor) body.pagination_key = cursor;
				if (filter !== "all") body.filter_status = [filter];

				const resp = await fetch(`${apiBaseUrl}/hub/list-my-work-emails`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(body),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (cursor) {
						setStints((prev) => [...prev, ...(data.work_emails ?? [])]);
					} else {
						setStints(data.work_emails ?? []);
					}
					setNextKey(data.next_pagination_key ?? null);
				} else {
					setLoadError(t("errors.loadFailed"));
				}
			} catch {
				setLoadError(t("errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, t, filterOption]
	);

	useEffect(() => {
		fetchStints(null, filterOption);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filterOption]);

	const handleAddSubmit = async () => {
		try {
			await addForm.validateFields();
		} catch {
			return;
		}
		const values = addForm.getFieldsValue();
		const req: AddWorkEmailRequest = {
			email_address: values.email_address.trim().toLowerCase(),
		};
		setAdding(true);
		setAddError(null);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const resp = await fetch(`${apiBaseUrl}/hub/add-work-email`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 201) {
				const data: AddWorkEmailResponse = await resp.json();
				message.success(t("success.added"));
				setAddModalVisible(false);
				addForm.resetFields();
				// Navigate to the verify page for this new stint
				navigate(`/settings/work-emails/${data.stint_id}/verify`);
			} else if (resp.status === 409) {
				setAddError(t("addModal.alreadyHeldError"));
			} else if (resp.status === 422) {
				setAddError(t("addModal.personalDomainError"));
			} else {
				setAddError(t("errors.addFailed"));
			}
		} catch {
			setAddError(t("errors.addFailed"));
		} finally {
			setAdding(false);
		}
	};

	const handleRemove = async (stintId: string) => {
		if (!sessionToken) return;
		setRemovingId(stintId);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const resp = await fetch(`${apiBaseUrl}/hub/remove-work-email`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ stint_id: stintId }),
			});
			if (resp.status === 200) {
				message.success(t("success.removed"));
				setStints((prev) =>
					prev.map((s) =>
						s.stint_id === stintId
							? { ...s, status: "ended" as WorkEmailStintStatus }
							: s
					)
				);
				// Refresh to get updated data
				fetchStints(null, filterOption);
			} else {
				message.error(t("errors.removeFailed"));
			}
		} catch {
			message.error(t("errors.removeFailed"));
		} finally {
			setRemovingId(null);
		}
	};

	const statusTag = (status: WorkEmailStintStatus) => {
		const colors: Record<WorkEmailStintStatus, string> = {
			active: "green",
			pending_verification: "orange",
			ended: "default",
		};
		const labels: Record<WorkEmailStintStatus, string> = {
			active: t("status.active"),
			pending_verification: t("status.pendingVerification"),
			ended: t("status.ended"),
		};
		return <Tag color={colors[status]}>{labels[status]}</Tag>;
	};

	const columns = [
		{
			title: t("table.emailAddress"),
			dataIndex: "email_address",
			key: "email_address",
		},
		{
			title: t("table.domain"),
			dataIndex: "domain",
			key: "domain",
		},
		{
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			render: (status: WorkEmailStintStatus) => statusTag(status),
		},
		{
			title: t("table.verifiedSince"),
			dataIndex: "first_verified_at",
			key: "first_verified_at",
			render: (val?: string) =>
				val ? formatDateTime(val, i18n.language) : "-",
		},
		{
			title: t("table.lastVerified"),
			dataIndex: "last_verified_at",
			key: "last_verified_at",
			render: (val?: string) =>
				val ? formatDateTime(val, i18n.language) : "-",
		},
		{
			title: t("table.reverifyDue"),
			dataIndex: "reverify_challenge_expires_at",
			key: "reverify_challenge_expires_at",
			render: (val?: string) =>
				val ? formatDateTime(val, i18n.language) : "-",
		},
		{
			title: t("table.actions"),
			key: "actions",
			render: (_: unknown, record: WorkEmailStintOwnerView) => {
				if (record.status === "ended") return null;
				const isRemoving = removingId === record.stint_id;
				return (
					<>
						{record.status === "pending_verification" && (
							<>
								<Button
									size="small"
									type="link"
									onClick={() =>
										navigate(`/settings/work-emails/${record.stint_id}/verify`)
									}
								>
									{t("table.enterCode")}
								</Button>
							</>
						)}
						{record.status === "active" &&
							record.reverify_challenge_issued_at && (
								<Button
									size="small"
									type="link"
									onClick={() =>
										navigate(`/settings/work-emails/${record.stint_id}`)
									}
								>
									{t("table.reverify")}
								</Button>
							)}
						<Popconfirm
							title={t("removeConfirm")}
							onConfirm={() => handleRemove(record.stint_id)}
							okText={t("table.remove")}
							cancelText={t("filter.all")}
						>
							<Button size="small" type="link" danger loading={isRemoving}>
								{t("table.remove")}
							</Button>
						</Popconfirm>
					</>
				);
			},
		},
	];

	const filterOptions: { label: string; value: FilterOption }[] = [
		{ label: t("filter.all"), value: "all" },
		{ label: t("filter.active"), value: "active" },
		{ label: t("filter.pending"), value: "pending_verification" },
		{ label: t("filter.ended"), value: "ended" },
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
					<Button icon={<ArrowLeftOutlined />}>{t("backToSettings")}</Button>
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
						setAddError(null);
						addForm.resetFields();
						setAddModalVisible(true);
					}}
				>
					{t("addWorkEmail")}
				</Button>
			</div>

			{loadError && (
				<Alert type="error" title={loadError} style={{ marginBottom: 16 }} />
			)}

			<Segmented
				options={filterOptions}
				value={filterOption}
				onChange={(val) => {
					setFilterOption(val as FilterOption);
				}}
				style={{ marginBottom: 16 }}
			/>

			<Spin spinning={loading}>
				<Table
					dataSource={stints}
					columns={columns}
					rowKey="stint_id"
					pagination={false}
					locale={{
						emptyText: t("emptyState"),
					}}
				/>
				{nextKey && (
					<div style={{ marginTop: 16, textAlign: "center" }}>
						<Button
							onClick={() => fetchStints(nextKey, filterOption)}
							loading={loading}
						>
							Load more
						</Button>
					</div>
				)}
			</Spin>

			{/* Add Work Email Modal */}
			<Modal
				open={addModalVisible}
				title={t("addModal.title")}
				onCancel={() => {
					setAddModalVisible(false);
					setAddError(null);
					addForm.resetFields();
				}}
				onOk={handleAddSubmit}
				okText={t("addModal.submit")}
				confirmLoading={adding}
				destroyOnHidden
			>
				<Spin spinning={adding}>
					{addError && (
						<Alert type="error" title={addError} style={{ marginBottom: 16 }} />
					)}
					<Form form={addForm} layout="vertical">
						<Form.Item
							name="email_address"
							label={t("addModal.emailLabel")}
							rules={[{ required: true, type: "email" }]}
						>
							<Input autoFocus />
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
