import React, { useCallback, useEffect, useState } from "react";
import {
	Table,
	Button,
	Popover,
	Space,
	Input,
	Spin,
	message,
	Modal,
	Typography,
} from "antd";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import type {
	CreateOpeningResponse,
	OpeningSummary,
	OpeningNumberRequest,
	ListOpeningsRequest,
	ListOpeningsResponse,
	OpeningStatus,
	RejectOpeningRequest,
} from "vetchium-specs/org/openings";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { formatDateTime } from "../../utils/dateFormat";

const { Title } = Typography;

interface OpeningAction {
	label: string;
	onClick: () => void;
	danger?: boolean;
}

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

	// Filter states
	const [statusFilter] = useState<OpeningStatus[]>([
		"draft",
		"pending_review",
		"published",
		"paused",
		"expired",
		"closed",
	]);
	const [visibilityFilter] = useState<string>("all");
	const [hiringManagerFilter] = useState<string>("");
	const [recruiterFilter] = useState<string>("");
	const [tagsFilter] = useState<string[]>([]);
	const [titlePrefixFilter] = useState<string>("");

	const hasManageRole = myInfo?.roles?.includes("org:manage_openings");

	const postOpeningAction = useCallback(
		async <TResponse,>(
			path: string,
			body: OpeningNumberRequest | RejectOpeningRequest | ListOpeningsRequest
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
			if (response.status === 204) {
				return { status: response.status };
			}
			if (response.headers.get("content-type")?.includes("application/json")) {
				const data = (await response.json()) as TResponse;
				return { status: response.status, data };
			}
			return { status: response.status };
		},
		[sessionToken]
	);

	const fetchOpenings = useCallback(
		async (paginationKey?: string) => {
			if (!myInfo) return;
			setLoading(true);
			try {
				const req: ListOpeningsRequest = {
					filter_status: statusFilter.length > 0 ? statusFilter : undefined,
					filter_is_internal:
						visibilityFilter === "internal"
							? true
							: visibilityFilter === "public"
								? false
								: undefined,
					filter_hiring_manager_email_address: hiringManagerFilter || undefined,
					filter_recruiter_email_address: recruiterFilter || undefined,
					filter_tag_ids: tagsFilter.length > 0 ? tagsFilter : undefined,
					filter_title_prefix: titlePrefixFilter || undefined,
					pagination_key: paginationKey,
					limit: 25,
				};

				const response = await postOpeningAction<ListOpeningsResponse>(
					"/org/list-openings",
					req
				);
				if (response.status === 200 && response.data) {
					setOpenings(response.data.openings);
					setPagination({
						next_pagination_key: response.data.next_pagination_key,
					});
				} else {
					message.error(t("errors.loadFailed"));
				}
			} catch {
				message.error(t("errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[
			hiringManagerFilter,
			myInfo,
			postOpeningAction,
			recruiterFilter,
			statusFilter,
			t,
			tagsFilter,
			titlePrefixFilter,
			visibilityFilter,
		]
	);

	useEffect(() => {
		void fetchOpenings();
	}, [fetchOpenings]);

	const handleDiscard = (openingNumber: number) => {
		Modal.confirm({
			title: t("discardConfirm"),
			okText: t("table.discard"),
			cancelText: "Cancel",
			okButtonProps: { danger: true },
			onOk: async () => {
				try {
					const response = await postOpeningAction<void>(
						"/org/discard-opening",
						{
							opening_number: openingNumber,
						}
					);
					if (response.status === 204) {
						message.success(t("success.discarded"));
						fetchOpenings();
					}
				} catch {
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
		const actions: Record<string, OpeningAction[]> = {
			draft: [
				{
					label: t("table.view"),
					onClick: () => handleViewClick(record),
				},
				{
					label: t("table.edit"),
					onClick: () => navigate(`/openings/${record.opening_number}/edit`),
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
					<Space orientation="vertical" style={{ width: 150 }}>
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
			const response = await postOpeningAction<unknown>("/org/submit-opening", {
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.submitted"));
				fetchOpenings();
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleApprove = async (openingNumber: number) => {
		try {
			const response = await postOpeningAction<unknown>(
				"/org/approve-opening",
				{
					opening_number: openingNumber,
				}
			);
			if (response.status === 200) {
				message.success(t("success.approved"));
				fetchOpenings();
			}
		} catch {
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
					document.getElementById("rejection-note") as HTMLTextAreaElement
				).value;
				try {
					const response = await postOpeningAction<unknown>(
						"/org/reject-opening",
						{
							opening_number: openingNumber,
							rejection_note: note,
						}
					);
					if (response.status === 200) {
						message.success(t("success.rejected"));
						fetchOpenings();
					}
				} catch {
					message.error(t("errors.transitionFailed"));
				}
			},
		});
	};

	const handlePause = async (openingNumber: number) => {
		try {
			const response = await postOpeningAction<unknown>("/org/pause-opening", {
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.paused"));
				fetchOpenings();
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleReopen = async (openingNumber: number) => {
		try {
			const response = await postOpeningAction<unknown>("/org/reopen-opening", {
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.reopened"));
				fetchOpenings();
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleClose = async (openingNumber: number) => {
		try {
			const response = await postOpeningAction<unknown>("/org/close-opening", {
				opening_number: openingNumber,
			});
			if (response.status === 200) {
				message.success(t("success.closed"));
				fetchOpenings();
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleArchive = async (openingNumber: number) => {
		try {
			const response = await postOpeningAction<unknown>(
				"/org/archive-opening",
				{
					opening_number: openingNumber,
				}
			);
			if (response.status === 200) {
				message.success(t("success.archived"));
				fetchOpenings();
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const handleDuplicate = async (openingNumber: number) => {
		try {
			const response = await postOpeningAction<CreateOpeningResponse>(
				"/org/duplicate-opening",
				{
					opening_number: openingNumber,
				}
			);
			if (response.status === 201 && response.data) {
				message.success(t("success.duplicated"));
				navigate(`/openings/${response.data.opening_number}/edit`);
			}
		} catch {
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
				type === "on_site"
					? "On-Site"
					: type.charAt(0).toUpperCase() + type.slice(1),
		},
		{
			title: t("table.positions"),
			dataIndex: "number_of_positions",
			key: "number_of_positions",
			width: 100,
			render: (_: unknown, record: OpeningSummary) =>
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
			render: (_: unknown, record: OpeningSummary) => renderActions(record),
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
						onClick={() => fetchOpenings(pagination.next_pagination_key)}
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
