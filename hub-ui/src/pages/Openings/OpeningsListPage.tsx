import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Empty,
	Input,
	Select,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	HubListOpeningsRequest,
	HubListOpeningsResponse,
	HubOpeningCard,
} from "vetchium-specs/hub/hiring-discovery";
import type { Region } from "vetchium-specs/global/global";
import { getApiBaseUrl } from "../../config";
import { getRegions } from "../../lib/api-client";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;
const { Search } = Input;

export const OpeningsListPage: React.FC = () => {
	const { t, i18n } = useTranslation("openings");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();
	const [openings, setOpenings] = useState<HubOpeningCard[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>();
	const [query, setQuery] = useState("");
	const [regions, setRegions] = useState<Region[]>([]);
	// Openings live in the hiring org's region, so the user browses one region
	// at a time. Default to the viewer's home region once myInfo loads.
	const [region, setRegion] = useState<string | undefined>();

	useEffect(() => {
		getRegions().then((res) => {
			if (res.status === 200 && res.data) setRegions(res.data);
		});
	}, []);

	useEffect(() => {
		if (myInfo?.home_region) {
			setRegion((prev) => prev ?? myInfo.home_region);
		}
	}, [myInfo]);

	const fetchOpenings = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken || !region) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: HubListOpeningsRequest = {
					limit: 20,
					filter_region: region,
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
		[sessionToken, query, region]
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

			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 16,
					alignItems: "center",
					marginBottom: 16,
				}}
			>
				<Search
					placeholder={t("searchPlaceholder")}
					allowClear
					onSearch={(val) => {
						setQuery(val);
					}}
					style={{ maxWidth: 400 }}
				/>
				<Select
					value={region}
					onChange={(val) => {
						setNextPaginationKey(undefined);
						setRegion(val);
					}}
					style={{ minWidth: 200 }}
					placeholder={t("region")}
					options={regions.map((r) => ({
						label: r.region_name,
						value: r.region_code,
					}))}
				/>
			</div>

			<Spin spinning={loading}>
				{openings.length === 0 && !loading ? (
					<Empty description={t("noOpeningsInRegion")} />
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
