import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, Space, Spin, Tag, Typography } from "antd";
import {
	DownloadOutlined,
	FileTextOutlined,
	UserOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
	OrgGetHubUserProfileRequest,
	OrgHubUserProfileResponse,
} from "vetchium-specs/org/hub-profiles";
import type { HubProfilePublicView } from "vetchium-specs/hub/profile";
import type { PublicEmployerStint } from "vetchium-specs/hub/work-emails";
import { getApiBaseUrl } from "../config";

const { Title, Text, Paragraph } = Typography;

function preferredName(
	displayNames: HubProfilePublicView["display_names"],
	locale: string,
	fallback: string
): string {
	if (!displayNames || displayNames.length === 0) return fallback;
	return (
		displayNames.find((d) => d.language_code === locale)?.display_name ||
		displayNames.find((d) => d.is_preferred)?.display_name ||
		displayNames[0]?.display_name ||
		fallback
	);
}

interface Props {
	sessionToken: string | null;
	handle: string;
	displayName: string;
	/** Cover letter from the application (optional). */
	coverLetter?: string;
	/** Relative API path that streams the resume (optional). */
	resumeUrl?: string;
}

/**
 * A self-contained candidate summary for HR and interviewers: profile (bio,
 * location, verified work history), the cover letter, and an inline resume
 * preview — so the key context is visible without leaving the page.
 */
export const CandidatePanel: React.FC<Props> = ({
	sessionToken,
	handle,
	displayName,
	coverLetter,
	resumeUrl,
}) => {
	const { t, i18n } = useTranslation("candidacies");
	const [profile, setProfile] = useState<HubProfilePublicView | null>(null);
	const [stints, setStints] = useState<PublicEmployerStint[]>([]);
	const [loading, setLoading] = useState(true);
	const [resumeObjectUrl, setResumeObjectUrl] = useState<string | null>(null);
	const [resumeType, setResumeType] = useState<string>("");
	const [resumeLoading, setResumeLoading] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			if (!sessionToken || !handle) {
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
				if (res.status === 200 && !cancelled) {
					const data = (await res.json()) as OrgHubUserProfileResponse;
					setProfile(data.profile);
					setStints(data.stints ?? []);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		load();
		return () => {
			cancelled = true;
		};
	}, [sessionToken, handle]);

	const loadResume = useCallback(async () => {
		if (!sessionToken || !resumeUrl || resumeObjectUrl) return;
		setResumeLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const res = await fetch(`${apiBaseUrl}${resumeUrl}`, {
				headers: { Authorization: `Bearer ${sessionToken}` },
			});
			if (res.ok) {
				const blob = await res.blob();
				setResumeType(blob.type);
				setResumeObjectUrl(URL.createObjectURL(blob));
			}
		} finally {
			setResumeLoading(false);
		}
	}, [sessionToken, resumeUrl, resumeObjectUrl]);

	// Auto-load the resume preview once the panel mounts.
	useEffect(() => {
		loadResume();
	}, [loadResume]);

	useEffect(() => {
		return () => {
			if (resumeObjectUrl) URL.revokeObjectURL(resumeObjectUrl);
		};
	}, [resumeObjectUrl]);

	const name = profile
		? preferredName(profile.display_names, i18n.language, displayName)
		: displayName;
	const isPdf = resumeType.includes("pdf");

	return (
		<Card
			title={
				<Space>
					<UserOutlined />
					{t("candidate")}
				</Space>
			}
			style={{ marginBottom: 16 }}
		>
			<Spin spinning={loading}>
				<div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
					<div style={{ flex: "1 1 280px", minWidth: 260 }}>
						<Title level={4} style={{ margin: 0 }}>
							{name}
						</Title>
						<Link to={`/u/${handle}`} target="_blank" rel="noreferrer">
							@{handle}
						</Link>
						{profile?.city && (
							<Text type="secondary" style={{ display: "block", marginTop: 4 }}>
								📍 {profile.city}
							</Text>
						)}
						{profile?.short_bio && (
							<Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
								{profile.short_bio}
							</Paragraph>
						)}
						{profile?.long_bio && (
							<Paragraph
								type="secondary"
								style={{ marginTop: 8, whiteSpace: "pre-wrap" }}
							>
								{profile.long_bio}
							</Paragraph>
						)}
						<div style={{ marginTop: 12 }}>
							<Link to={`/u/${handle}`} target="_blank" rel="noreferrer">
								{t("viewFullProfile")}
							</Link>
						</div>
					</div>

					<div style={{ flex: "1 1 280px", minWidth: 260 }}>
						<Text strong>{t("workHistory")}</Text>
						{stints.length === 0 ? (
							<Paragraph type="secondary" style={{ marginTop: 4 }}>
								{t("noWorkHistory")}
							</Paragraph>
						) : (
							<div style={{ marginTop: 8 }}>
								{stints.map((s, i) => (
									<div key={i} style={{ marginBottom: 6 }}>
										<Tag color={s.is_current ? "green" : "default"}>
											{s.start_year}–
											{s.is_current
												? t("present")
												: (s.end_year ?? t("present"))}
										</Tag>
										<Text>{s.domain}</Text>
									</div>
								))}
							</div>
						)}
					</div>
				</div>

				{coverLetter && (
					<div style={{ marginTop: 16 }}>
						<Text strong>{t("coverLetterLabel")}</Text>
						<Paragraph style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
							{coverLetter}
						</Paragraph>
					</div>
				)}

				{resumeUrl && (
					<div style={{ marginTop: 16 }}>
						<Space style={{ marginBottom: 8 }}>
							<Text strong>
								<FileTextOutlined /> {t("resumeLabel")}
							</Text>
							{resumeObjectUrl && (
								<Button
									type="link"
									icon={<DownloadOutlined />}
									href={resumeObjectUrl}
									target="_blank"
									rel="noreferrer"
									style={{ paddingLeft: 0 }}
								>
									{t("openResume")}
								</Button>
							)}
						</Space>
						<Spin spinning={resumeLoading}>
							{resumeObjectUrl && isPdf ? (
								<iframe
									title={t("resumeLabel")}
									src={resumeObjectUrl}
									style={{
										width: "100%",
										height: 480,
										border: "1px solid #f0f0f0",
										borderRadius: 4,
									}}
								/>
							) : resumeObjectUrl ? (
								<Text type="secondary">{t("resumeNoPreview")}</Text>
							) : (
								!resumeLoading && (
									<Text type="secondary">{t("resumeUnavailable")}</Text>
								)
							)}
						</Spin>
					</div>
				)}
			</Spin>
		</Card>
	);
};
