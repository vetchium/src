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
	OrgPlan,
	AdminListOrgPlansRequest,
	AdminSetOrgPlanRequest,
} from "vetchium-specs/org/tiers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;

const PLANS = ["free", "silver", "gold", "enterprise"] as const;

export function OrgPlansPage() {
	const { t } = useTranslation("orgPlans");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();

	const canManage =
		myInfo?.roles.includes("admin:superadmin") ||
		myInfo?.roles.includes("admin:manage_org_plans") ||
		false;

	const [items, setItems] = useState<OrgPlan[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>();
	const [filterPlan, setFilterPlan] = useState<string | undefined>();
	const [filterDomain, setFilterDomain] = useState<string>("");
	const [settingPlan, setSettingPlan] = useState(false);
	const [selectedOrg, setSelectedOrg] = useState<OrgPlan | null>(null);
	const [form] = Form.useForm();

	const fetchItems = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: AdminListOrgPlansRequest = {
					limit: 20,
				};
				if (filterPlan) req.filter_plan_id = filterPlan;
				if (filterDomain) req.filter_domain = filterDomain;
				if (paginationKey) req.pagination_key = paginationKey;

				const resp = await fetch(`${baseUrl}/admin/org-plan/list`, {
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
		[sessionToken, filterPlan, filterDomain, message, t]
	);

	useEffect(() => {
		setItems([]);
		setNextPaginationKey(undefined);
		fetchItems();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken, filterPlan]);

	const handleSetPlan = async (values: { plan_id: string; reason: string }) => {
		if (!selectedOrg || !sessionToken) return;
		setSettingPlan(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: AdminSetOrgPlanRequest = {
				org_id: selectedOrg.org_id,
				plan_id: values.plan_id,
				reason: values.reason,
			};
			const resp = await fetch(`${baseUrl}/admin/org-plan/set`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				message.success(t("success.planSet"));
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
				message.error(t("errors.setPlanFailed"));
			}
		} catch {
			message.error(t("errors.setPlanFailed"));
		} finally {
			setSettingPlan(false);
		}
	};

	const columns = [
		{
			title: t("table.domain"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("table.currentPlan"),
			dataIndex: ["current_plan", "display_name"],
			key: "current_plan",
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
			render: (_: unknown, record: OrgPlan) =>
				canManage ? (
					<Button
						size="small"
						onClick={() => {
							setSelectedOrg(record);
							form.setFieldsValue({
								plan_id: record.current_plan.plan_id,
								reason: "",
							});
						}}
					>
						{t("table.changePlan")}
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
				<Input
					placeholder={t("filter.domainPlaceholder", "Search by domain...")}
					style={{ width: 250 }}
					allowClear
					value={filterDomain}
					onChange={(e) => setFilterDomain(e.target.value)}
					onPressEnter={() => {
						setItems([]);
						setNextPaginationKey(undefined);
						fetchItems();
					}}
				/>
				<Button
					type="primary"
					onClick={() => {
						setItems([]);
						setNextPaginationKey(undefined);
						fetchItems();
					}}
				>
					{t("filter.search", "Search")}
				</Button>
				<Select
					allowClear
					placeholder={t("filter.planPlaceholder")}
					style={{ width: 180 }}
					onChange={(v) => setFilterPlan(v)}
					options={PLANS.map((id) => ({ value: id, label: id }))}
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
				<Spin spinning={settingPlan}>
					<Form form={form} layout="vertical" onFinish={handleSetPlan}>
						<Form.Item
							name="plan_id"
							label={t("modal.planLabel")}
							rules={[{ required: true }]}
						>
							<Select options={PLANS.map((id) => ({ value: id, label: id }))} />
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
