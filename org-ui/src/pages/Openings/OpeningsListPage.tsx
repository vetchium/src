import { useCallback, useEffect, useState } from "react";
import {
	Button,
	Spin,
	message,
	Typography,
	Tag,
	Empty,
	Badge,
	Card,
} from "antd";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import type {
	OpeningSummary,
	ListOpeningsRequest,
	ListOpeningsResponse,
	OpeningStatus,
} from "vetchium-specs/org/openings";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";

const { Title, Text } = Typography;

const STATUS_TAG_COLORS: Record<string, string> = {
	draft: "default",
	pending_review: "orange",
	published: "green",
	paused: "geekblue",
	expired: "red",
	closed: "volcano",
	archived: "default",
};

const STATUS_BADGE_STATUSES: Record<
	string,
	"default" | "processing" | "success" | "error" | "warning"
> = {
	draft: "default",
	pending_review: "warning",
	published: "success",
	paused: "processing",
	expired: "error",
	closed: "error",
	archived: "default",
};

export default function OpeningsListPage() {
	const { t, i18n } = useTranslation("openings");
	const navigate = useNavigate();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const [openings, setOpenings] = useState<OpeningSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [pagination, setPagination] = useState<{
		next_pagination_key?: string;
	}>({});

	const statusFilter: OpeningStatus[] = [
		"draft",
		"pending_review",
		"published",
		"paused",
		"expired",
		"closed",
	];

	const hasManageRole =
		myInfo?.roles?.includes("org:manage_openings") ||
		myInfo?.roles?.includes("org:superadmin");

	const fetchOpenings = useCallback(
		async (paginationKey?: string) => {
			if (!myInfo || !sessionToken) return;
			setLoading(true);
			try {
				const req: ListOpeningsRequest = {
					filter_status: statusFilter,
					pagination_key: paginationKey,
					limit: 25,
				};
				const baseUrl = await getApiBaseUrl();
				const response = await fetch(`${baseUrl}/org/list-openings`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (response.status === 200) {
					const data = (await response.json()) as ListOpeningsResponse;
					if (paginationKey) {
						setOpenings((prev) => [...prev, ...(data.openings ?? [])]);
					} else {
						setOpenings(data.openings);
					}
					setPagination({ next_pagination_key: data.next_pagination_key });
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		// statusFilter is a stable literal; intentionally omitted from deps
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[myInfo, sessionToken, t]
	);

	useEffect(() => {
		void fetchOpenings();
	}, [fetchOpenings]);

	const renderOpening = (record: OpeningSummary) => (
		<Card
			key={record.opening_id}
			hoverable
			onClick={() => navigate(`/openings/${record.opening_number}`)}
			styles={{ body: { padding: 16 } }}
			style={{ marginBottom: 12 }}
		>
			{/* Top section: number + title on the left, status tags on the right */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					gap: 16,
					flexWrap: "wrap",
				}}
			>
				<div style={{ flex: 1, minWidth: 0 }}>
					<span style={{ fontSize: 16, fontWeight: 600 }}>
						<span style={{ color: "#8c8c8c", fontFamily: "monospace" }}>
							#{record.opening_number}
						</span>{" "}
						{record.title}
					</span>
				</div>
				<div style={{ flexShrink: 0, display: "flex", gap: 8 }}>
					<Badge
						status={STATUS_BADGE_STATUSES[record.status] ?? "default"}
						text={
							<Tag color={STATUS_TAG_COLORS[record.status]}>
								{t(`status.${record.status}`)}
							</Tag>
						}
					/>
					<Tag color={record.is_internal ? "blue" : "cyan"}>
						{record.is_internal
							? t("filter.visibilityInternal")
							: t("filter.visibilityPublic")}
					</Tag>
				</div>
			</div>

			{/* Bottom section: metadata laid out horizontally */}
			<div
				style={{
					marginTop: 12,
					display: "flex",
					gap: 24,
					flexWrap: "wrap",
					fontSize: 13,
					color: "#595959",
				}}
			>
				<span>
					<Text type="secondary">{t("table.employmentType")}: </Text>
					{t(`form.${record.employment_type}`)}
				</span>
				<span>
					<Text type="secondary">{t("table.positions")}: </Text>
					<strong>{record.filled_positions}</strong>
					<span style={{ color: "#8c8c8c" }}>
						/{record.number_of_positions}
					</span>
				</span>
				{record.hiring_manager?.full_name && (
					<span>
						<Text type="secondary">{t("table.hiringManager")}: </Text>
						{record.hiring_manager.full_name}
					</span>
				)}
				<span>
					<Text type="secondary">{t("table.createdAt")}: </Text>
					{formatDateTime(record.created_at, i18n.language)}
				</span>
			</div>
		</Card>
	);

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
				{hasManageRole && (
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => navigate("/openings/new")}
					>
						{t("createOpening")}
					</Button>
				)}
			</div>

			<Spin spinning={loading}>
				{openings.length === 0 && !loading ? (
					<Empty
						description={
							<span>
								{t("errors.loadFailed", { defaultValue: "No openings yet." })}
								{hasManageRole && (
									<>
										{" "}
										<Button
											type="link"
											style={{ padding: 0 }}
											onClick={() => navigate("/openings/new")}
										>
											{t("createOpening")}
										</Button>
									</>
								)}
							</span>
						}
					/>
				) : (
					openings.map(renderOpening)
				)}
				{pagination.next_pagination_key && !loading && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button
							onClick={() => fetchOpenings(pagination.next_pagination_key)}
						>
							{t("table.loadMore")}
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
}
