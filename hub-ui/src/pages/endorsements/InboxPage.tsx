import React, { useCallback, useEffect, useState } from "react";
import { Button, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
	EndorsementRequestIncoming,
	EndorsementRequestState,
	ListEndorsementRequestsIncomingResponse,
} from "vetchium-specs/hub/endorsements";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

const stateColors: Record<EndorsementRequestState, string> = {
	pending: "orange",
	written: "green",
	declined: "red",
	expired: "default",
};

export const EndorsementInboxPage: React.FC = () => {
	const { t } = useTranslation("endorsements");
	const { sessionToken } = useAuth();
	const [requests, setRequests] = useState<EndorsementRequestIncoming[]>([]);
	const [loading, setLoading] = useState(false);

	const fetchRequests = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(
				`${apiBaseUrl}/hub/list-endorsement-requests-incoming`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ limit: 20 }),
				}
			);
			if (res.status === 200) {
				const data: ListEndorsementRequestsIncomingResponse = await res.json();
				setRequests(data.requests ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken]);

	useEffect(() => {
		fetchRequests();
	}, [fetchRequests]);

	const columns = [
		{
			title: t("colleague"),
			dataIndex: "candidate_handle",
			key: "candidate_handle",
			render: (handle: string, record: EndorsementRequestIncoming) =>
				`${record.candidate_display_name} (@${handle})`,
		},
		{
			title: t("role"),
			dataIndex: "opening_title",
			key: "opening_title",
		},
		{
			title: t("company"),
			dataIndex: "org_domain",
			key: "org_domain",
		},
		{
			title: t("asked"),
			dataIndex: "requested_at",
			key: "requested_at",
			render: (v: string) => new Date(v).toLocaleDateString(),
		},
		{
			title: t("state"),
			dataIndex: "state",
			key: "state",
			render: (state: EndorsementRequestState) => (
				<Tag color={stateColors[state]}>{t(state)}</Tag>
			),
		},
		{
			title: t("actions"),
			key: "actions",
			render: (_: unknown, record: EndorsementRequestIncoming) => (
				<>
					{record.state === "pending" && (
						<Link to={`/endorsement-requests/${record.request_id}/write`}>
							<Button type="primary" size="small">
								{t("writeButton")}
							</Button>
						</Link>
					)}
					{record.state === "written" && (
						<Link to={`/endorsement-requests/${record.request_id}/write`}>
							<Button size="small">{t("edit")}</Button>
						</Link>
					)}
				</>
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
			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>
			<Table
				columns={columns}
				dataSource={requests}
				rowKey="request_id"
				loading={loading}
				locale={{ emptyText: t("noRequests") }}
			/>
		</div>
	);
};
