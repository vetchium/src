import { ArrowLeftOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Button, Card, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ConnectWidget } from "../../components/ConnectWidget";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { COUNTRIES } from "../../lib/countries";
import type { HubProfilePublicView } from "vetchium-specs/hub/profile";

const { Title, Text, Paragraph } = Typography;

export function PublicProfilePage() {
	const { t, i18n } = useTranslation("profile");
	const { handle } = useParams<{ handle: string }>();
	const { sessionToken } = useAuth();

	const [profile, setProfile] = useState<HubProfilePublicView | null>(null);
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);

	const getPreferredDisplayName = useCallback(
		(
			displayNames: HubProfilePublicView["display_names"]
		): string => {
			if (!displayNames || displayNames.length === 0) return handle ?? "";
			// Try to match viewer's locale
			const locale = i18n.language;
			const localeMatch = displayNames.find(
				(dn) => dn.language_code === locale
			);
			if (localeMatch) return localeMatch.display_name;
			// Fall back to preferred
			const preferred = displayNames.find((dn) => dn.is_preferred);
			if (preferred) return preferred.display_name;
			return displayNames[0]?.display_name ?? handle ?? "";
		},
		[i18n.language, handle]
	);

	useEffect(() => {
		const run = async () => {
			if (!sessionToken || !handle) {
				setNotFound(true);
				setLoading(false);
				return;
			}
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/hub/get-profile`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ handle }),
				});
				if (response.status === 200) {
					const data: HubProfilePublicView = await response.json();
					setProfile(data);
				} else if (response.status === 404) {
					setNotFound(true);
				}
			} catch {
				setNotFound(true);
			} finally {
				setLoading(false);
			}
		};
		run();
	}, [sessionToken, handle]);

	if (loading) {
		return (
			<div
				style={{
					width: "100%",
					maxWidth: 1200,
					padding: "24px 16px",
					alignSelf: "flex-start",
				}}
			>
				<Spin spinning />
			</div>
		);
	}

	if (notFound || !profile) {
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
						<Button icon={<ArrowLeftOutlined />}>
							{t("myProfile.backToSettings")}
						</Button>
					</Link>
				</div>
				<Title level={2}>{t("publicProfile.userNotFound")}</Title>
				<Text type="secondary">@{handle}</Text>
			</div>
		);
	}

	const displayName = getPreferredDisplayName(profile.display_names);
	const countryName = profile.resident_country_code
		? (COUNTRIES.find((c) => c.code === profile.resident_country_code)?.name ??
			profile.resident_country_code)
		: null;

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
					<Button icon={<ArrowLeftOutlined />}>
						{t("myProfile.backToSettings")}
					</Button>
				</Link>
			</div>

			{/* Top section: picture | name + bio + handle | connect widget */}
			<div
				style={{
					display: "flex",
					gap: 24,
					alignItems: "center",
					marginBottom: 24,
					flexWrap: "wrap",
				}}
			>
				{/* Profile picture */}
				{profile.profile_picture_url ? (
					<img
						src={profile.profile_picture_url}
						alt={displayName}
						style={{
							width: 128,
							height: 128,
							borderRadius: "50%",
							objectFit: "cover",
							flexShrink: 0,
						}}
					/>
				) : (
					<Avatar size={128} icon={<UserOutlined />} />
				)}

				{/* Name + bio + handle */}
				<div style={{ flex: 1, minWidth: 0 }}>
					<Title level={2} style={{ margin: 0 }}>
						{displayName}
					</Title>
					{profile.short_bio && (
						<Text type="secondary" style={{ fontSize: 16 }}>
							{profile.short_bio}
						</Text>
					)}
					<div>
						<Text
							type="secondary"
							style={{ fontFamily: "monospace", fontSize: 14 }}
						>
							@{profile.handle}
						</Text>
					</div>
				</div>

				{/* Connect button widget */}
				<div style={{ flexShrink: 0 }}>
					<ConnectWidget handle={profile.handle} />
				</div>
			</div>

			{/* Location */}
			{(countryName || profile.city) && (
				<Text type="secondary" style={{ marginBottom: 24, display: "block" }}>
					{[profile.city, countryName].filter(Boolean).join(", ")}
				</Text>
			)}

			{/* Long bio */}
			{profile.long_bio && (
				<Card style={{ marginBottom: 24 }}>
					<Paragraph style={{ whiteSpace: "pre-line", margin: 0 }}>
						{profile.long_bio}
					</Paragraph>
				</Card>
			)}

			{/* Verified employers card — TODO(hub-employer-ids) */}
			{/* TODO(hub-employer-ids): Replace with actual employer stints when hub-employer-ids ships */}
			<Card title={t("publicProfile.verifiedEmployers")}>
				<Text type="secondary">
					{t("publicProfile.noVerifiedEmployers")}
				</Text>
			</Card>
		</div>
	);
}
