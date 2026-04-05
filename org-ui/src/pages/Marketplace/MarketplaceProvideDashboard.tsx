import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	ListMarketplaceCapabilitiesRequest,
	ListProviderEnrollmentsRequest,
	MarketplaceCapability,
	MarketplaceEnrollment,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

function enrollmentStatusColor(status: string): string {
	switch (status) {
		case "approved":
			return "green";
		case "pending_review":
			return "gold";
		case "rejected":
			return "red";
		case "suspended":
			return "orange";
		case "expired":
			return "default";
		default:
			return "default";
	}
}

export function MarketplaceProvideDashboard() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();

	const [enrollments, setEnrollments] = useState<MarketplaceEnrollment[]>([]);
	const [capabilities, setCapabilities] = useState<
		Map<string, MarketplaceCapability>
	>(new Map());
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>(undefined);

	const loadCapabilities = useCallback(async () => {
		if (!sessionToken) return;
		try {
			const baseUrl = await getApiBaseUrl();
			const req: ListMarketplaceCapabilitiesRequest = { limit: 100 };
			const resp = await fetch(`${baseUrl}/org/marketplace/capabilities/list`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				const map = new Map<string, MarketplaceCapability>();
				for (const cap of data.capabilities ?? []) {
					map.set(cap.capability_slug, cap);
				}
				setCapabilities(map);
			}
		} catch {
			// ignore — capabilities are display-only
		}
	}, [sessionToken]);

	const loadEnrollments = useCallback(
		async (paginationKey?: string, reset?: boolean) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListProviderEnrollmentsRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const resp = await fetch(
					`${baseUrl}/org/marketplace/provider-enrollments/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(req),
					}
				);
				if (resp.status === 200) {
					const data = await resp.json();
					const items: MarketplaceEnrollment[] = data.enrollments ?? [];
					if (reset) {
						setEnrollments(items);
					} else {
						setEnrollments((prev) => [...prev, ...items]);
					}
					setNextPaginationKey(data.next_pagination_key ?? undefined);
				} else {
					message.error(t("provide.errors.loadFailed"));
				}
			} catch {
				message.error(t("provide.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		loadCapabilities();
		loadEnrollments(undefined, true);
	}, [loadCapabilities, loadEnrollments]);

	const columns = [
		{
			title: t("provide.dashboardTitle"),
			dataIndex: "capability_slug",
			key: "capability_slug",
			render: (slug: string) => capabilities.get(slug)?.display_name ?? slug,
		},
		{
			title: t("provide.enrollmentsTitle"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => (
				<Tag color={enrollmentStatusColor(status)}>
					{t(`provide.enrollmentStatuses.${status}`)}
				</Tag>
			),
		},
		{
			title: "",
			key: "actions",
			render: (_: unknown, record: MarketplaceEnrollment) => (
				<Button
					size="small"
					onClick={() =>
						navigate(`/marketplace/provide/${record.capability_slug}`)
					}
				>
					{t("provide.viewDetails")}
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
					{t("provide.dashboardTitle")}
				</Title>
				<Button
					type="primary"
					onClick={() => navigate("/marketplace/capabilities")}
				>
					{t("provide.applyButton")}
				</Button>
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={enrollments}
					columns={columns}
					rowKey="capability_slug"
					pagination={false}
					locale={{ emptyText: t("provide.noEnrollments") }}
				/>
			</Spin>

			{nextPaginationKey && (
				<Button
					onClick={() => loadEnrollments(nextPaginationKey, false)}
					loading={loading}
					block
					style={{ marginTop: 16 }}
				>
					{t("provide.loadMore")}
				</Button>
			)}
		</div>
	);
}
