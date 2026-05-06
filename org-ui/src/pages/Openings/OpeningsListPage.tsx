import React, { useEffect, useState } from "react";
import {
	Table,
	Button,
	Popover,
	Space,
	Segmented,
	Select,
	Input,
	Spin,
	message,
	Modal,
} from "antd";
import {
	ArrowLeftOutlined,
	PlusOutlined,
	DeleteOutlined,
	CopyOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import type {
	OpeningSummary,
	ListOpeningsRequest,
	OpeningStatus,
} from "vetchium-specs/org/openings";
import { OrgAPIClient } from "../../lib/org-api-client";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";
import { Title } from "antd/es/typography/Title";

export default function OpeningsListPage() {
	const { t, i18n } = useTranslation("openings");
	const navigate = useNavigate();
	const { myInfo } = useMyInfo();
	const [openings, setOpenings] = useState<OpeningSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [pagination, setPagination] = useState<{
		next_pagination_key?: string;
	}>({});

	// Filter states
	const [statusFilter, setStatusFilter] = useState<OpeningStatus[]>([
		"draft",
		"pending_review",
		"published",
		"paused",
		"expired",
		"closed",
	]);
	const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
	const [hiringManagerFilter, setHiringManagerFilter] = useState<string>("");
	const [recruiterFilter, setRecruiterFilter] = useState<string>("");
	const [tagsFilter, setTagsFilter] = useState<string[]>([]);
	const [titlePrefixFilter, setTitlePrefixFilter] = useState<string>("");

	const hasManageRole = myInfo?.roles?.includes("org:manage_openings");

	const fetchOpenings = async (paginationKey?: string) => {
		if (!myInfo) return;
		setLoading(true);
		try {
			const api = new OrgAPIClient();
			const req: ListOpeningsRequest = {
				filter_status:
					statusFilter.length > 0 ? statusFilter : undefined,
				filter_is_internal:
					visibilityFilter === "internal"
						? true
						: visibilityFilter === "public"
							? false
							: undefined,
				filter_hiring_manager_org_user_id:
					hiringManagerFilter || undefined,
				filter_recruiter_org_user_id: recruiterFilter || undefined,
				filter_tag_ids: tagsFilter.length > 0 ? tagsFilter : undefined,
				filter_title_prefix: titlePrefixFilter || undefined,
				pagination_key: paginationKey,
				limit: 25,
			};

			const response = await api.listOpenings(req);
			if (response.status === 200) {
				setOpenings(response.body.openings);
				setPagination({
					next_pagination_key: response.body.next_pagination_key,
				});
			} else {
				message.error(t("errors.loadFailed"));
			}
		} catch (error) {
			message.error(t("errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchOpenings();
	}, [
		statusFilter,
		visibilityFilter,
		hiringManagerFilter,
		recruiterFilter,
		tagsFilter,
		titlePrefixFilter,
		myInfo,
	]);

	const handleDiscard = (openingNumber: number) => {
		Modal.confirm({
			title: t("discardConfirm"),
			okText: t("table.discard"),
			cancelText: "Cancel",
			danger: true,
			onOk: async () => {
				try {
					const api = new OrgAPIClient();
					const response = await api.discardOpening({
						opening_number: openingNumber,
					});
					if (response.status === 204) {
						message.success(t("success.discarded"));
						fetchOpenings();
					}
				} catch (error) {
					message.error(t("errors.transitionFailed"));
				}
			},
		});
	};

	const renderActions = (record: OpeningSummary) => {
		if (!hasManageRole) {
			return (
				<Button type="text" onClick={() => handleViewClick(record)}>
					{t("table.view")}
				</Button>
			);
		}

		const status = record.status as string;
		const actions = {
			draft: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.edit"),
					onClick: () =>
						navigate(
							`/openings/${record.opening_number}/edit`
						),
				},
				{
					label: t("table.submit"),
					onClick: () => handleSubmit(record.opening_number),
				},
				{
					label: t("table.discard"),
					onClick: () => handleDiscard(record.opening_number),
					danger: true,
				},
				{
					label: t("table.duplicate"),
					onClick: () => handleDuplicate(record.opening_number),
				},
			],
			pending_review: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.approve"),
					onClick: () => handleApprove(record.opening_number),
				},
				{
					label: t("table.reject"),
					onClick: () => handleRejectModal(record.opening_number),
				},
				{
					label: t("table.duplicate"),
					onClick: () => handleDuplicate(record.opening_number),
				},
			],
			published: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.pause"),
					onClick: () => handlePause(record.opening_number),
				},
				{
					label: t("table.close"),
					onClick: () => handleClose(record.opening_number),
				},
				{
					label: t("table.duplicate"),
					onClick: () => handleDuplicate(record.opening_number),
				},
			],
			paused: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.reopen"),
					onClick: () => handleReopen(record.opening_number),
				},
				{
					label: t("table.close"),
					onClick: () => handleClose(record.opening_number),
				},
				{
					label: t("table.duplicate"),
					onClick: () => handleDuplicate(record.opening_number),
				},
			],
			expired: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.archive"),
					onClick: () => handleArchive(record.opening_number),
				},
				{
					label: t("table.duplicate"),
					onClick: () => handleDuplicate(record.opening_number),
				},
			],
			closed: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.archive"),
					onClick: () => handleArchive(record.opening_number),
				},
				{
					label: t("table.duplicate"),
					onClick: () => handleDuplicate(record.opening_number),
				},
			],
			archived: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.duplicate"),
					onClick: () => handleDuplicate(record.opening_number),
				},
			],
		};

		const actionList = actions[status as keyof typeof actions] || [];

		return (
			<Popover
				content={
					<Space direction="vertical" style={{ width: 150 }}>
						{actionList.map((action, idx) => (
							<Button
								key={idx}
								type="text"
								danger={action.danger}
								onClick={action.onClick}
								block
								style={{
									textAlign: "left",
									padding: 0,
								}}
							>
								{action.label}
							</Button>
						))}
					</Space>
				}
				trigger="click"
			>
				<Button type="text">Actions</Button>
			</Popover>
		);
	};

	const handleViewClick = (record: OpeningSummary) => {
		navigate(`/openings/${record.opening_number}`);
	};

	const handleSubmit = async (openingNumber: number) => {
		try {
			const api = new OrgAPIClient();
			const response = await api.submitOpening({
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.submitted"));
				fetchOpenings();
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleApprove = async (openingNumber: number) => {
		try {
			const api = new OrgAPIClient();
			const response = await api.approveOpening({
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.approved"));
				fetchOpenings();
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleRejectModal = (openingNumber: number) => {
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
						opening_number: openingNumber,
						rejection_note: note,
					});
					if (response.status === 200) {
						message.success(t("success.rejected"));
						fetchOpenings();
					}
				} catch (error) {
					message.error(t("errors.transitionFailed"));
				}
			},
		});
	};

	const handlePause = async (openingNumber: number) => {
		try {
			const api = new OrgAPIClient();
			const response = await api.pauseOpening({
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.paused"));
				fetchOpenings();
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleReopen = async (openingNumber: number) => {
		try {
			const api = new OrgAPIClient();
			const response = await api.reopenOpening({
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.reopened"));
				fetchOpenings();
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleClose = async (openingNumber: number) => {
		try {
			const api = new OrgAPIClient();
			const response = await api.closeOpening({
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.closed"));
				fetchOpenings();
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleArchive = async (openingNumber: number) => {
		try {
			const api = new OrgAPIClient();
			const response = await api.archiveOpening({
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.archived"));
				fetchOpenings();
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleDuplicate = async (openingNumber: number) => {
		try {
			const api = new OrgAPIClient();
			const response = await api.duplicateOpening({
				opening_number: openingNumber,
			});
			if (response.status === 201) {
				message.success(t("success.duplicated"));
				navigate(`/openings/${response.body.opening_number}/edit`);
			}
		} catch (error) {
			message.error(t("errors.transitionFailed"));
		}
	};

	const columns = [
		{
			title: t("table.openingNumber"),
			dataIndex: "opening_number",
			key: "opening_number",
			width: 80,
		},
		{
			title: t("table.title"),
			dataIndex: "title",
			key: "title",
			width: 200,
		},
		{
			title: t("table.visibility"),
			dataIndex: "is_internal",
			key: "is_internal",
			width: 120,
			render: (is_internal: boolean) =>
				is_internal
					? t("filter.visibilityInternal")
					: t("filter.visibilityPublic"),
		},
		{
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			width: 120,
			render: (status: OpeningStatus) =>
				t(`status.${status.replace(/-/g, "_")}`),
		},
		{
			title: t("table.hiringManager"),
			dataIndex: ["hiring_manager", "full_name"],
			key: "hiring_manager",
			width: 140,
		},
		{
			title: t("table.recruiter"),
			dataIndex: ["recruiter", "full_name"],
			key: "recruiter",
			width: 140,
		},
		{
			title: t("table.employmentType"),
			dataIndex: "employment_type",
			key: "employment_type",
			width: 120,
			render: (type: string) => t(`form.${type}`),
		},
		{
			title: t("table.workLocation"),
			dataIndex: "work_location_type",
			key: "work_location_type",
			width: 120,
			render: (type: string) =>
				type === "on_site" ? "On-Site" : type.charAt(0).toUpperCase() + type.slice(1),
		},
		{
			title: t("table.positions"),
			dataIndex: "number_of_positions",
			key: "number_of_positions",
			width: 100,
			render: (_, record: OpeningSummary) =>
				`${record.filled_positions}/${record.number_of_positions}`,
		},
		{
			title: t("table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			width: 140,
			render: (date: string) => formatDateTime(date, i18n.language),
		},
		{
			title: t("table.actions"),
			key: "actions",
			fixed: "right" as const,
			width: 120,
			render: (_, record: OpeningSummary) => renderActions(record),
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
					<Button icon={<ArrowLeftOutlined />}>
						{t("backToDashboard")}
					</Button>
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
				<Table
					columns={columns}
					dataSource={openings}
					rowKey="opening_id"
					pagination={false}
					scroll={{ x: 1200 }}
				/>
				{pagination.next_pagination_key && (
					<Button
						style={{ marginTop: 16 }}
						onClick={() =>
							fetchOpenings(pagination.next_pagination_key)
						}
					>
						Load More
					</Button>
				)}
				{openings.length === 0 && !loading && (
					<div style={{ textAlign: "center", padding: 40 }}>
						No openings yet.
						{hasManageRole &&
							" Click 'Create Opening' to post your first role."}
					</div>
				)}
			</Spin>
		</div>
	);
}
