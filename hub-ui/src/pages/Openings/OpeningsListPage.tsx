import React, { useCallback, useEffect, useState } from "react";
import { Button, Empty, Input, Spin, Table, Tag, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	HubListOpeningsRequest,
	HubListOpeningsResponse,
	HubOpeningCard,
} from "vetchium-specs/hub/hiring-discovery";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;
const { Search } = Input;

export const OpeningsListPage: React.FC = () => {
	const { t, i18n } = useTranslation("openings");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const [openings, setOpenings] = useState<HubOpeningCard[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>();
	const [query, setQuery] = useState("");

	const fetchOpenings = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: HubListOpeningsRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
					...(query ? { filter_query: query } : {}),
				};
				const res = await fetch(`${apiBaseUrl}/hub/list-openings`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data: HubListOpeningsResponse = await res.json();
					if (paginationKey) {
						setOpenings((prev) => [...prev, ...data.openings]);
					} else {
						setOpenings(data.openings);
					}
					setNextPaginationKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, query]
	);

	useEffect(() => {
		fetchOpenings();
	}, [fetchOpenings]);

	const columns = [
		{
			title: t("role"),
			dataIndex: "title",
			key: "title",
			render: (title: string, record: HubOpeningCard) => (
				<Link
					to={`/org/${record.org_domain}/openings/${record.opening_number}`}
				>
					{title}
				</Link>
			),
		},
		{ title: t("company"), dataIndex: "org_name", key: "org_name" },
		{
			title: t("employmentType"),
			dataIndex: "employment_type",
			key: "employment_type",
			render: (v: string) => <Tag>{v.replace(/_/g, " ")}</Tag>,
		},
		{
			title: t("posted"),
			dataIndex: "first_published_at",
			key: "first_published_at",
			render: (v: string) => formatDateTime(v, i18n.language),
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

			<Search
				placeholder={t("searchPlaceholder")}
				allowClear
				onSearch={(val) => {
					setQuery(val);
				}}
				style={{ maxWidth: 400, marginBottom: 16 }}
			/>

			<Spin spinning={loading}>
				{openings.length === 0 && !loading ? (
					<Empty description={t("noOpenings")} />
				) : (
					<Table
						dataSource={openings}
						columns={columns}
						rowKey={(r) => `${r.org_domain}-${r.opening_number}`}
						pagination={false}
						onRow={(record) => ({
							onClick: () =>
								navigate(
									`/org/${record.org_domain}/openings/${record.opening_number}`
								),
							style: { cursor: "pointer" },
						})}
					/>
				)}
				{nextPaginationKey && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button
							onClick={() => fetchOpenings(nextPaginationKey)}
							loading={loading}
						>
							Load more
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
};
