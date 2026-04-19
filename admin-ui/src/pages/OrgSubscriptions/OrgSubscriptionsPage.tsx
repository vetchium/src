import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Form,
	Input,
	Modal,
	Select,
	Space,
	Spin,
	Table,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	OrgSubscription,
	AdminListOrgSubscriptionsRequest,
	AdminSetOrgTierRequest,
} from "vetchium-specs/org/tiers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;

const TIERS = ["free", "silver", "gold", "enterprise"] as const;

export function OrgSubscriptionsPage() {
	const { t } = useTranslation("orgSubscriptions");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();

	const canManage =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:manage_org_subscriptions") ||
		false;

	const [items, setItems] = useState<OrgSubscription[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>();
	const [filterTier, setFilterTier] = useState<string | undefined>();
	const [settingTier, setSettingTier] = useState(false);
	const [selectedOrg, setSelectedOrg] = useState<OrgSubscription | null>(null);
	const [form] = Form.useForm();

	const fetchItems = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: AdminListOrgSubscriptionsRequest = {
					limit: 20,
				};
				if (filterTier) req.filter_tier_id = filterTier;
				if (paginationKey) req.pagination_key = paginationKey;

				const resp = await fetch(`${baseUrl}/admin/org-subscriptions/list`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					setItems((prev) =>
						paginationKey ? [...prev, ...data.items] : data.items
					);
					setNextPaginationKey(data.next_pagination_key);
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, filterTier, message, t]
	);

	useEffect(() => {
		setItems([]);
		setNextPaginationKey(undefined);
		fetchItems();
	}, [fetchItems]);

	const handleSetTier = async (values: { tier_id: string; reason: string }) => {
		if (!selectedOrg || !sessionToken) return;
		setSettingTier(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: AdminSetOrgTierRequest = {
				org_id: selectedOrg.org_id,
				tier_id: values.tier_id,
				reason: values.reason,
			};
			const resp = await fetch(`${baseUrl}/admin/org-subscriptions/set-tier`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.tierSet"));
				setSelectedOrg(null);
				form.resetFields();
				setItems([]);
				setNextPaginationKey(undefined);
				fetchItems();
			} else if (resp.status === 409) {
				const blocked = await resp.json();
				message.error(
					t("errors.downgradeBlocked", { details: JSON.stringify(blocked) })
				);
			} else {
				message.error(t("errors.setTierFailed"));
			}
		} catch {
			message.error(t("errors.setTierFailed"));
		} finally {
			setSettingTier(false);
		}
	};

	const columns = [
		{
			title: t("table.domain"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("table.currentTier"),
			dataIndex: ["current_tier", "display_name"],
			key: "current_tier",
		},
		{
			title: t("table.updatedAt"),
			dataIndex: "updated_at",
			key: "updated_at",
			render: (v: string) => new Date(v).toLocaleDateString(),
		},
		{
			title: t("table.actions"),
			key: "actions",
			render: (_: unknown, record: OrgSubscription) =>
				canManage ? (
					<Button
						size="small"
						onClick={() => {
							setSelectedOrg(record);
							form.setFieldsValue({
								tier_id: record.current_tier.tier_id,
								reason: "",
							});
						}}
					>
						{t("table.changeTier")}
					</Button>
				) : null,
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

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>

			<Space style={{ marginBottom: 16 }}>
				<Select
					allowClear
					placeholder={t("filter.tierPlaceholder")}
					style={{ width: 180 }}
					onChange={(v) => setFilterTier(v)}
					options={TIERS.map((id) => ({ value: id, label: id }))}
				/>
			</Space>

			<Spin spinning={loading}>
				<Table
					dataSource={items}
					columns={columns}
					rowKey="org_id"
					pagination={false}
				/>
			</Spin>

			{nextPaginationKey && (
				<div style={{ textAlign: "center", marginTop: 16 }}>
					<Button onClick={() => fetchItems(nextPaginationKey)}>
						{t("loadMore")}
					</Button>
				</div>
			)}

			<Modal
				open={!!selectedOrg}
				title={t("modal.title", { domain: selectedOrg?.org_domain })}
				onCancel={() => {
					setSelectedOrg(null);
					form.resetFields();
				}}
				footer={null}
			>
				<Spin spinning={settingTier}>
					<Form form={form} layout="vertical" onFinish={handleSetTier}>
						<Form.Item
							name="tier_id"
							label={t("modal.tierLabel")}
							rules={[{ required: true }]}
						>
							<Select options={TIERS.map((id) => ({ value: id, label: id }))} />
						</Form.Item>
						<Form.Item
							name="reason"
							label={t("modal.reasonLabel")}
							rules={[{ required: true, max: 2000 }]}
						>
							<Input.TextArea rows={4} maxLength={2000} showCount />
						</Form.Item>
						<Form.Item>
							<Button type="primary" htmlType="submit">
								{t("modal.submit")}
							</Button>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
