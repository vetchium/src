import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Spin,
	message,
	Modal,
	Input,
	Space,
	Tag,
	Card,
	Typography,
	Descriptions,
	Alert,
	Divider,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, Link } from "react-router-dom";
import type {
	CreateOpeningResponse,
	Opening,
	OpeningNumberRequest,
	RejectOpeningRequest,
} from "vetchium-specs/org/openings";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime, formatDate } from "../../utils/dateFormat";

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

function userLabel(u: { full_name?: string; email_address: string }): string {
	return u.full_name ? `${u.full_name} (${u.email_address})` : u.email_address;
}

export default function OpeningDetailPage() {
	const { t, i18n } = useTranslation("openings");
	const navigate = useNavigate();
	const { openingNumber } = useParams<{ openingNumber: string }>();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const [opening, setOpening] = useState<Opening | null>(null);
	const [loading, setLoading] = useState(false);

	const hasManageRole =
		myInfo?.roles?.includes("org:manage_openings") ||
		myInfo?.roles?.includes("org:superadmin");

	const isSubmitter =
		opening?.status === "pending_review" &&
		!!opening.submitted_by &&
		opening.submitted_by.email_address === myInfo?.email_address;

	const postOpeningAction = useCallback(
		async <TResponse,>(
			path: string,
			body: OpeningNumberRequest | RejectOpeningRequest
		): Promise<{ status: number; data?: TResponse }> => {
			if (!sessionToken) return { status: 401 };
			const baseUrl = await getApiBaseUrl();
			const response = await fetch(`${baseUrl}${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(body),
			});
			if (response.status === 204) return { status: response.status };
			if (response.headers.get("content-type")?.includes("application/json")) {
				const data = (await response.json()) as TResponse;
				return { status: response.status, data };
			}
			return { status: response.status };
		},
		[sessionToken]
	);

	const fetchOpening = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const response = await postOpeningAction<Opening>("/org/get-opening", {
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200 && response.data) {
				setOpening(response.data);
			} else {
				message.error(t("errors.loadFailed"));
				navigate("/openings");
			}
		} catch {
			message.error(t("errors.loadFailed"));
			navigate("/openings");
		} finally {
			setLoading(false);
		}
	}, [navigate, openingNumber, postOpeningAction, sessionToken, t]);

	useEffect(() => {
		if (openingNumber) void fetchOpening();
	}, [fetchOpening, openingNumber, myInfo]);

	const openingNum = parseInt(openingNumber || "0");

	const handleTransition = async (path: string, successKey: string) => {
		try {
			const response = await postOpeningAction<Opening>(path, {
				opening_number: openingNum,
			});
			if (response.status === 200 && response.data) {
				message.success(t(`success.${successKey}`));
				setOpening(response.data);
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleRejectModal = () => {
		Modal.confirm({
			title: t("rejectModal.title"),
			content: (
				<Input.TextArea
					id="rejection-note-detail"
					placeholder={t("rejectModal.noteLabel")}
					maxLength={2000}
				/>
			),
			okText: t("rejectModal.submit"),
			cancelText: "Cancel",
			onOk: async () => {
				const note = (
					document.getElementById(
						"rejection-note-detail"
					) as HTMLTextAreaElement
				).value;
				try {
					const response = await postOpeningAction<Opening>(
						"/org/reject-opening",
						{ opening_number: openingNum, rejection_note: note }
					);
					if (response.status === 200 && response.data) {
						message.success(t("success.rejected"));
						setOpening(response.data);
					}
				} catch {
					message.error(t("errors.transitionFailed"));
				}
			},
		});
	};

	const handleDuplicate = async () => {
		try {
			const response = await postOpeningAction<CreateOpeningResponse>(
				"/org/duplicate-opening",
				{ opening_number: openingNum }
			);
			if (response.status === 201 && response.data) {
				message.success(t("success.duplicated"));
				navigate(`/openings/${response.data.opening_number}/edit`);
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const renderActions = () => {
		if (!opening || !hasManageRole) return null;

		const status = opening.status;
		const byStatus: Record<string, React.ReactNode[]> = {
			draft: [
				<Button
					key="edit"
					onClick={() => navigate(`/openings/${opening.opening_number}/edit`)}
				>
					{t("table.edit")}
				</Button>,
				<Button
					key="submit"
					onClick={() => handleTransition("/org/submit-opening", "submitted")}
				>
					{t("table.submit")}
				</Button>,
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			pending_review: [
				...(!isSubmitter
					? [
							<Button
								key="approve"
								onClick={() =>
									handleTransition("/org/approve-opening", "approved")
								}
							>
								{t("table.approve")}
							</Button>,
						]
					: []),
				<Button key="reject" onClick={handleRejectModal}>
					{t("table.reject")}
				</Button>,
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			published: [
				<Button
					key="pause"
					onClick={() => handleTransition("/org/pause-opening", "paused")}
				>
					{t("table.pause")}
				</Button>,
				<Button
					key="close"
					onClick={() => handleTransition("/org/close-opening", "closed")}
				>
					{t("table.close")}
				</Button>,
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			paused: [
				<Button
					key="reopen"
					onClick={() => handleTransition("/org/reopen-opening", "reopened")}
				>
					{t("table.reopen")}
				</Button>,
				<Button
					key="close"
					onClick={() => handleTransition("/org/close-opening", "closed")}
				>
					{t("table.close")}
				</Button>,
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			expired: [
				<Button
					key="archive"
					onClick={() => handleTransition("/org/archive-opening", "archived")}
				>
					{t("table.archive")}
				</Button>,
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			closed: [
				<Button
					key="archive"
					onClick={() => handleTransition("/org/archive-opening", "archived")}
				>
					{t("table.archive")}
				</Button>,
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			archived: [
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
		};

		return (
			byStatus[status] ?? [
				<Button key="duplicate" onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			]
		);
	};

	if (loading || !opening) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					minHeight: 400,
				}}
			>
				<Spin size="large" />
			</div>
		);
	}

	const expiryDate = opening.first_published_at
		? (() => {
				const d = new Date(opening.first_published_at);
				d.setDate(d.getDate() + 180);
				return d;
			})()
		: null;

	const jobDetailItems = [
		{
			key: "employment_type",
			label: t("detail.employmentType"),
			children: t(`form.${opening.employment_type}`),
		},
		{
			key: "work_location_type",
			label: t("detail.workLocationType"),
			children: t(`form.${opening.work_location_type}`),
		},
		{
			key: "positions",
			label: t("detail.filled"),
			children: (
				<span>
					<strong>{opening.filled_positions}</strong> /{" "}
					{opening.number_of_positions}
				</span>
			),
		},
		...(opening.min_yoe !== undefined || opening.max_yoe !== undefined
			? [
					{
						key: "experience",
						label: t("detail.experience"),
						children: [
							opening.min_yoe !== undefined
								? `${opening.min_yoe} ${t("detail.years")}`
								: null,
							opening.max_yoe !== undefined
								? `${opening.max_yoe} ${t("detail.years")}`
								: null,
						]
							.filter(Boolean)
							.join(" – "),
					},
				]
			: []),
		...(opening.min_education_level
			? [
					{
						key: "education",
						label: t("detail.education"),
						children: t(`form.${opening.min_education_level}`),
					},
				]
			: []),
		...(opening.addresses.length > 0
			? [
					{
						key: "addresses",
						label: t("form.addresses"),
						children: opening.addresses
							.map((a) => `${a.title} — ${a.city}, ${a.country}`)
							.join("; "),
						span: 2,
					},
				]
			: []),
	];

	const compensationItems = opening.salary
		? [
				{
					key: "salary",
					label: t("detail.salary"),
					children: `${opening.salary.currency} ${opening.salary.min_amount.toLocaleString()} – ${opening.salary.max_amount.toLocaleString()}`,
					span: 2,
				},
			]
		: null;

	const teamItems = [
		{
			key: "hiring_manager",
			label: t("detail.hiringManager"),
			children: userLabel(opening.hiring_manager),
		},
		{
			key: "recruiter",
			label: t("detail.recruiter"),
			children: userLabel(opening.recruiter),
		},
		...(opening.status === "pending_review" && opening.submitted_by
			? [
					{
						key: "submitted_by",
						label: t("detail.submittedBy"),
						children: userLabel(opening.submitted_by),
					},
				]
			: []),
		...(opening.hiring_team_members.length > 0
			? [
					{
						key: "team_members",
						label: t("detail.teamMembers"),
						children: (
							<Space size={[4, 4]} wrap>
								{opening.hiring_team_members.map((m) => (
									<Tag key={m.email_address}>{userLabel(m)}</Tag>
								))}
							</Space>
						),
						span: 2,
					},
				]
			: []),
		...(opening.watchers.length > 0
			? [
					{
						key: "watchers",
						label: t("detail.watchers"),
						children: (
							<Space size={[4, 4]} wrap>
								{opening.watchers.map((w) => (
									<Tag key={w.email_address}>{userLabel(w)}</Tag>
								))}
							</Space>
						),
						span: 2,
					},
				]
			: []),
	];

	const timestampItems = [
		{
			key: "created_at",
			label: t("detail.createdAt"),
			children: formatDateTime(opening.created_at, i18n.language),
		},
		{
			key: "updated_at",
			label: t("detail.updatedAt"),
			children: formatDateTime(opening.updated_at, i18n.language),
		},
		...(opening.first_published_at
			? [
					{
						key: "published_at",
						label: t("detail.publishedAt"),
						children: formatDateTime(opening.first_published_at, i18n.language),
					},
					{
						key: "expires_on",
						label: t("detail.expiresOn"),
						children: expiryDate
							? formatDate(expiryDate.toISOString(), i18n.language)
							: t("detail.none"),
					},
				]
			: []),
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
				<Link to="/openings">
					<Button icon={<ArrowLeftOutlined />}>{t("backToOpenings")}</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					marginBottom: 20,
				}}
			>
				<div>
					<Title level={2} style={{ margin: 0, marginBottom: 8 }}>
						{opening.title}
					</Title>
					<Space size={8}>
						<Text type="secondary">#{opening.opening_number}</Text>
						<Tag color={STATUS_TAG_COLORS[opening.status]}>
							{t(`status.${opening.status}`)}
						</Tag>
						<Tag color={opening.is_internal ? "blue" : "cyan"}>
							{opening.is_internal
								? t("filter.visibilityInternal")
								: t("filter.visibilityPublic")}
						</Tag>
					</Space>
				</div>
				<Space>{renderActions()}</Space>
			</div>

			{/* Status banners */}
			{opening.status === "draft" && opening.rejection_note && (
				<Alert
					type="warning"
					showIcon
					title={t("detail.rejectionBanner", {
						note: opening.rejection_note,
					})}
					style={{ marginBottom: 16 }}
				/>
			)}
			{opening.status === "published" && expiryDate && (
				<Alert
					type="info"
					showIcon
					title={t("detail.publishedBanner", {
						expiresOn: formatDate(expiryDate.toISOString(), i18n.language),
					})}
					style={{ marginBottom: 16 }}
				/>
			)}
			{opening.status === "paused" && expiryDate && (
				<Alert
					type="warning"
					showIcon
					title={t("detail.pausedBanner", {
						expiresOn: formatDate(expiryDate.toISOString(), i18n.language),
					})}
					style={{ marginBottom: 16 }}
				/>
			)}
			{opening.status === "expired" && (
				<Alert
					type="error"
					showIcon
					title={t("detail.expiredBanner", {
						expiredOn: expiryDate
							? formatDate(expiryDate.toISOString(), i18n.language)
							: "",
					})}
					style={{ marginBottom: 16 }}
				/>
			)}

			{/* Description */}
			<Card style={{ marginBottom: 16 }}>
				<Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>
					{opening.description}
				</Typography.Paragraph>
			</Card>

			{/* Job Details */}
			<Card title={t("detail.jobDetails")} style={{ marginBottom: 16 }}>
				<Descriptions bordered column={2} items={jobDetailItems} size="small" />
			</Card>

			{/* Compensation */}
			{compensationItems && (
				<Card title={t("detail.compensation")} style={{ marginBottom: 16 }}>
					<Descriptions
						bordered
						column={2}
						items={compensationItems}
						size="small"
					/>
				</Card>
			)}

			{/* Hiring Team */}
			<Card title={t("detail.hiringTeam")} style={{ marginBottom: 16 }}>
				<Descriptions bordered column={2} items={teamItems} size="small" />
			</Card>

			{/* Additional Info */}
			{(opening.cost_center ||
				opening.tags.length > 0 ||
				opening.internal_notes) && (
				<Card title={t("detail.additionalInfo")} style={{ marginBottom: 16 }}>
					{opening.cost_center && (
						<>
							<Text type="secondary">{t("detail.costCenter")}: </Text>
							<Text>{opening.cost_center.display_name}</Text>
							{(opening.tags.length > 0 || opening.internal_notes) && (
								<Divider style={{ margin: "12px 0" }} />
							)}
						</>
					)}
					{opening.tags.length > 0 && (
						<>
							<Text type="secondary">{t("detail.tags")}: </Text>
							<Space size={[4, 4]} wrap style={{ marginTop: 4 }}>
								{opening.tags.map((tag) => (
									<Tag key={tag.tag_id} color="purple">
										{tag.display_name || tag.tag_id}
									</Tag>
								))}
							</Space>
							{opening.internal_notes && (
								<Divider style={{ margin: "12px 0" }} />
							)}
						</>
					)}
					{opening.internal_notes && (
						<>
							<Text type="secondary">{t("detail.internalNotes")}: </Text>
							<Typography.Paragraph
								style={{
									whiteSpace: "pre-wrap",
									marginTop: 4,
									marginBottom: 0,
								}}
							>
								{opening.internal_notes}
							</Typography.Paragraph>
						</>
					)}
				</Card>
			)}

			{/* Timestamps */}
			<Card title={t("detail.timestamps")}>
				<Descriptions bordered column={2} items={timestampItems} size="small" />
			</Card>
		</div>
	);
}
