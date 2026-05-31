import React, { useCallback, useEffect, useState } from "react";
import { Avatar, Button, Card, Empty, Spin, Tag, Typography } from "antd";
import { ArrowLeftOutlined, UserOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import type {
	OrgGetHubUserProfileRequest,
	OrgHubUserProfileResponse,
} from "vetchium-specs/org/hub-profiles";
import type { HubProfilePublicView } from "vetchium-specs/hub/profile";
import type { PublicEmployerStint } from "vetchium-specs/hub/work-emails";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text, Paragraph } = Typography;

function getPreferredDisplayName(
	displayNames: HubProfilePublicView["display_names"],
	locale: string,
	handle: string
): string {
	if (!displayNames || displayNames.length === 0) return handle;
	const localeMatch = displayNames.find((dn) => dn.language_code === locale);
	if (localeMatch) return localeMatch.display_name;
	const preferred = displayNames.find((dn) => dn.is_preferred);
	if (preferred) return preferred.display_name;
	return displayNames[0]?.display_name ?? handle;
}

export const HubUserProfilePage: React.FC = () => {
	const { t, i18n } = useTranslation("hubProfile");
	const { sessionToken } = useAuth();
	const { handle } = useParams<{ handle: string }>();
	const [data, setData] = useState<OrgHubUserProfileResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);

	const fetchProfile = useCallback(async () => {
		if (!sessionToken || !handle) {
			setNotFound(true);
			setLoading(false);
			return;
		}
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: OrgGetHubUserProfileRequest = { handle };
			const res = await fetch(`${apiBaseUrl}/org/get-hub-user-profile`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				setData((await res.json()) as OrgHubUserProfileResponse);
			} else {
				setNotFound(true);
			}
		} catch {
			setNotFound(true);
		} finally {
			setLoading(false);
		}
	}, [sessionToken, handle]);

	useEffect(() => {
		fetchProfile();
	}, [fetchProfile]);

	if (loading) {
		return (
			<div
				style={{
					width: "100%",
					maxWidth: 800,
					padding: "24px 16px",
					alignSelf: "flex-start",
				}}
			>
				<Spin spinning />
			</div>
		);
	}

	if (notFound || !data) {
		return (
			<div
				style={{
					width: "100%",
					maxWidth: 800,
					padding: "24px 16px",
					alignSelf: "flex-start",
				}}
			>
				<div style={{ marginBottom: 16 }}>
					<Link to="/">
						<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
					</Link>
				</div>
				<Empty description={t("notFoundDesc", { handle })} />
			</div>
		);
	}

	const { profile, stints } = data;
	const displayName = getPreferredDisplayName(
		profile.display_names,
		i18n.language,
		handle ?? ""
	);

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 800,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			{/* Profile hero */}
			<Card style={{ marginBottom: 16 }}>
				<div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
					<Avatar size={80} icon={<UserOutlined />} />
					<div style={{ flex: 1 }}>
						<Title level={3} style={{ margin: 0, marginBottom: 4 }}>
							{displayName}
						</Title>
						<Text type="secondary" style={{ fontFamily: "monospace" }}>
							@{profile.handle}
						</Text>
						{profile.short_bio && (
							<Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
								{profile.short_bio}
							</Paragraph>
						)}
						{profile.city && (
							<Text type="secondary" style={{ display: "block", marginTop: 4 }}>
								{profile.city}
							</Text>
						)}
					</div>
				</div>
			</Card>

			{/* Work history */}
			{stints.length > 0 && (
				<Card title={t("workHistory")}>
					{stints.map((stint: PublicEmployerStint, i) => (
						<div
							key={i}
							style={{
								marginBottom: 8,
								display: "flex",
								alignItems: "center",
								gap: 8,
							}}
						>
							<Text strong>{stint.domain}</Text>
							<Tag color={stint.is_current ? "green" : "default"}>
								{stint.start_year}–
								{stint.is_current
									? t("present")
									: (stint.end_year ?? t("present"))}
							</Tag>
						</div>
					))}
				</Card>
			)}
		</div>
	);
};
