import React, { useEffect, useState } from "react";
import {
	Button,
	Spin,
	message,
	Modal,
	Input,
	Space,
	Tag,
	Divider,
	Card,
} from "antd";
import {
	ArrowLeftOutlined,
	EditOutlined,
	CopyOutlined,
	DeleteOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, Link } from "react-router-dom";
import type { Opening } from "vetchium-specs/org/openings";
import { OrgAPIClient } from "../../lib/org-api-client";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime, formatDate } from "../../utils/dateFormat";
import { Title, Paragraph, Text } from "antd/es/typography";

export default function OpeningDetailPage() {
	const { t, i18n } = useTranslation("openings");
	const navigate = useNavigate();
	const { openingNumber } = useParams<{ openingNumber: string }>();
	const { myInfo } = useMyInfo();
	const [opening, setOpening] = useState<Opening | null>(null);
	const [loading, setLoading] = useState(false);

	const hasManageRole = myInfo?.roles?.includes("org:manage_openings");

	useEffect(() => {
		if (openingNumber) {
			fetchOpening();
		}
	}, [openingNumber, myInfo]);

	const fetchOpening = async () => {
		setLoading(true);
		try {
			const api = new OrgAPIClient();
			const response = await api.getOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				setOpening(response.body);
			} else {
				message.error(t("errors.loadFailed"));
				navigate("/openings");
			}
		} catch (error) {
			message.error(t("errors.loadFailed"));
			navigate("/openings");
		} finally {
			setLoading(false);
		}
	};

	const getExpiryDate = (firstPublishedAt: string | undefined) => {
		if (!firstPublishedAt) return null;
		const date = new Date(firstPublishedAt);
		date.setDate(date.getDate() + 180);
		return date;
	};

	const handleSubmit = async () => {
		try {
			const api = new OrgAPIClient();
			const response = await api.submitOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				message.success(t("success.submitted"));
				setOpening(response.body);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleApprove = async () => {
		try {
			const api = new OrgAPIClient();
			const response = await api.approveOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				message.success(t("success.approved"));
				setOpening(response.body);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleRejectModal = () => {
		Modal.confirm({
			title: t("rejectModal.title"),
			content: (
				<Input.TextArea
					id="rejection-note"
					placeholder={t("rejectModal.noteLabel")}
					maxLength={2000}
				/>
			),
			okText: t("rejectModal.submit"),
			cancelText: "Cancel",
			onOk: async () => {
				const note = (
					document.getElementById(
						"rejection-note"
					) as HTMLTextAreaElement
				).value;
				try {
					const api = new OrgAPIClient();
					const response = await api.rejectOpening({
						opening_number: parseInt(openingNumber || "0"),
						rejection_note: note,
					});
					if (response.status === 200) {
						message.success(t("success.rejected"));
						setOpening(response.body);
					}
				} catch (error) {
					message.error(t("errors.transitionFailed"));
				}
			},
		});
	};

	const handlePause = async () => {
		try {
			const api = new OrgAPIClient();
			const response = await api.pauseOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				message.success(t("success.paused"));
				setOpening(response.body);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleReopen = async () => {
		try {
			const api = new OrgAPIClient();
			const response = await api.reopenOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				message.success(t("success.reopened"));
				setOpening(response.body);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleClose = async () => {
		try {
			const api = new OrgAPIClient();
			const response = await api.closeOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				message.success(t("success.closed"));
				setOpening(response.body);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleArchive = async () => {
		try {
			const api = new OrgAPIClient();
			const response = await api.archiveOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				message.success(t("success.archived"));
				setOpening(response.body);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleDuplicate = async () => {
		try {
			const api = new OrgAPIClient();
			const response = await api.duplicateOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 201) {
				message.success(t("success.duplicated"));
				navigate(`/openings/${response.body.opening_number}/edit`);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const renderActions = () => {
		if (!opening || !hasManageRole) return null;

		const status = opening.status;
		const actions = {
			draft: [
				<Button
					onClick={() =>
						navigate(`/openings/${opening.opening_number}/edit`)
					}
				>
					{t("table.edit")}
				</Button>,
				<Button onClick={handleSubmit}>
					{t("table.submit")}
				</Button>,
				<Button onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			pending_review: [
				<Button onClick={handleApprove}>
					{t("table.approve")}
				</Button>,
				<Button onClick={handleRejectModal}>
					{t("table.reject")}
				</Button>,
				<Button onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			published: [
				<Button onClick={handlePause}>{t("table.pause")}</Button>,
				<Button onClick={handleClose}>{t("table.close")}</Button>,
				<Button onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			paused: [
				<Button onClick={handleReopen}>{t("table.reopen")}</Button>,
				<Button onClick={handleClose}>{t("table.close")}</Button>,
				<Button onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			expired: [
				<Button onClick={handleArchive}>
					{t("table.archive")}
				</Button>,
				<Button onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			closed: [
				<Button onClick={handleArchive}>
					{t("table.archive")}
				</Button>,
				<Button onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
			archived: [
				<Button onClick={handleDuplicate}>
					{t("table.duplicate")}
				</Button>,
			],
		};

		return (actions[status as keyof typeof actions] || []).map(
			(action, idx) => (
				<span key={idx}>{action}</span>
			)
		);
	};

	if (loading || !opening) {
		return (
			<Spin spinning={true} style={{ display: "flex", minHeight: 400 }} />
		);
	}

	const expiryDate = getExpiryDate(opening.first_published_at);

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
					<Button icon={<ArrowLeftOutlined />}>
						{t("backToDashboard")}
					</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					marginBottom: 24,
				}}
			>
				<div>
					<Title level={2} style={{ margin: 0, marginBottom: 8 }}>
						{opening.title}
					</Title>
					<Space split={<Divider type="vertical" />}>
						<Text>#{opening.opening_number}</Text>
						<Tag color={opening.is_internal ? "blue" : "green"}>
							{opening.is_internal
								? t("filter.visibilityInternal")
								: t("filter.visibilityPublic")}
						</Tag>
						<Tag>{t(`status.${opening.status}`)}</Tag>
					</Space>
				</div>
				<Space>{renderActions()}</Space>
			</div>

			{opening.status === "draft" && opening.rejection_note && (
				<Card
					style={{
						marginBottom: 16,
						borderColor: "#faad14",
						backgroundColor: "#fffbe6",
					}}
				>
					<Text>
						{t("detail.rejectionBanner", {
							approver: "Manager",
							note: opening.rejection_note,
						})}
					</Text>
				</Card>
			)}

			{opening.status === "published" && expiryDate && (
				<Card
					style={{
						marginBottom: 16,
						borderColor: "#1890ff",
						backgroundColor: "#e6f7ff",
					}}
				>
					<Text>
						{t("detail.publishedBanner", {
							expiresOn: formatDate(
								expiryDate.toISOString(),
								i18n.language
							),
						})}
					</Text>
				</Card>
			)}

			{opening.status === "paused" && expiryDate && (
				<Card
					style={{
						marginBottom: 16,
						borderColor: "#faad14",
						backgroundColor: "#fffbe6",
					}}
				>
					<Text>
						{t("detail.pausedBanner", {
							expiresOn: formatDate(
								expiryDate.toISOString(),
								i18n.language
							),
						})}
					</Text>
				</Card>
			)}

			{opening.status === "expired" && (
				<Card
					style={{
						marginBottom: 16,
						borderColor: "#ff4d4f",
						backgroundColor: "#fff1f0",
					}}
				>
					<Text>
						{t("detail.expiredBanner", {
							expiredOn: formatDate(
								opening.first_published_at
									? new Date(opening.first_published_at)
										.toISOString()
									: new Date().toISOString(),
								i18n.language
							),
						})}
					</Text>
				</Card>
			)}

			<Card style={{ marginBottom: 16 }}>
				<Paragraph>
					<strong>Description:</strong>
				</Paragraph>
				<Paragraph>{opening.description}</Paragraph>

				<Divider />

				<Paragraph>
					<strong>Employment Type:</strong> {opening.employment_type}
				</Paragraph>
				<Paragraph>
					<strong>Work Location:</strong> {opening.work_location_type}
				</Paragraph>
				<Paragraph>
					<strong>Positions:</strong> {opening.number_of_positions}
				</Paragraph>

				{opening.min_yoe !== undefined && (
					<Paragraph>
						<strong>Min Experience:</strong> {opening.min_yoe} years
					</Paragraph>
				)}
				{opening.max_yoe !== undefined && (
					<Paragraph>
						<strong>Max Experience:</strong> {opening.max_yoe} years
					</Paragraph>
				)}

				{opening.salary && (
					<Paragraph>
						<strong>Salary:</strong> {opening.salary.currency}{" "}
						{opening.salary.min_amount} -{" "}
						{opening.salary.max_amount}
					</Paragraph>
				)}

				<Paragraph>
					<strong>Hiring Manager:</strong>{" "}
					{opening.hiring_manager.full_name}
				</Paragraph>
				<Paragraph>
					<strong>Recruiter:</strong> {opening.recruiter.full_name}
				</Paragraph>

				<Paragraph>
					<strong>Created:</strong>{" "}
					{formatDateTime(opening.created_at, i18n.language)}
				</Paragraph>
				{opening.first_published_at && (
					<Paragraph>
						<strong>Published:</strong>{" "}
						{formatDateTime(opening.first_published_at, i18n.language)}
					</Paragraph>
				)}
			</Card>
		</div>
	);
}
