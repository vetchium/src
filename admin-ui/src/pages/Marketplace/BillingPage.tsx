import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	AdminBillingRecord,
	AdminListBillingResponse,
} from "vetchium-specs/admin/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

export function BillingPage() {
	const { t } = useTranslation("marketplace");
	const { message } = App.useApp();
	const { sessionToken } = useAuth();

	const [records, setRecords] = useState<AdminBillingRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [hasMore, setHasMore] = useState(false);

	const fetchBilling = useCallback(
		async (reset = true) => {
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const body: { pagination_key?: string; limit: number } = { limit: 50 };
				if (!reset && nextKey) body.pagination_key = nextKey;
				const resp = await fetch(
					`${apiBaseUrl}/admin/marketplace/billing/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(body),
					}
				);
				if (resp.status === 200) {
					const data: AdminListBillingResponse = await resp.json();
					if (reset) {
						setRecords(data.records);
					} else {
						setRecords((prev) => [...prev, ...data.records]);
					}
					setNextKey(data.next_pagination_key);
					setHasMore(!!data.next_pagination_key);
				} else {
					message.error(t("billing.errors.loadFailed"));
				}
			} catch {
				message.error(t("billing.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, nextKey, message, t]
	);

	useEffect(() => {
		fetchBilling(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionToken]);

	const columns = [
		{
			title: t("billing.table.consumerOrgDomain"),
			dataIndex: "consumer_org_domain",
			key: "consumer_org_domain",
		},
		{
			title: t("billing.table.providerOrgDomain"),
			dataIndex: "provider_org_domain",
			key: "provider_org_domain",
		},
		{
			title: t("billing.table.capabilitySlug"),
			dataIndex: "capability_slug",
			key: "capability_slug",
		},
		{
			title: t("billing.table.eventType"),
			dataIndex: "event_type",
			key: "event_type",
			render: (v: string) => <Tag>{v}</Tag>,
		},
		{
			title: t("billing.table.note"),
			dataIndex: "note",
			key: "note",
			render: (v?: string) => v ?? "-",
		},
		{
			title: t("billing.table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			render: (v: string) => formatDateTime(v),
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
				{t("tabs.billing")}
			</Title>

			<Spin spinning={loading}>
				<Table
					dataSource={records}
					columns={columns}
					rowKey={(r, i) =>
						`${r.consumer_org_domain}:${r.provider_org_domain}:${r.capability_slug}:${i}`
					}
					pagination={false}
					size="small"
				/>
			</Spin>
			{hasMore && (
				<div style={{ marginTop: 16 }}>
					<Button onClick={() => fetchBilling(false)}>{t("loadMore")}</Button>
				</div>
			)}
		</div>
	);
}
