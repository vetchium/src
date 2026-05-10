import React, { useCallback, useEffect, useState } from "react";
import {
	Table,
	Button,
	Space,
	Input,
	Spin,
	message,
	Modal,
	Typography,
	Tag,
	Dropdown,
	Empty,
	Badge,
} from "antd";
import type { MenuProps } from "antd";
import {
	ArrowLeftOutlined,
	PlusOutlined,
	DownOutlined,
} from "@ant-design/icons";
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

const STATUS_TAG_COLORS: Record<string, string> = {
	draft: "default",
	pending_review: "orange",
	published: "green",
	paused: "geekblue",
	expired: "red",
	closed: "volcano",
	archived: "default",
};

const STATUS_BADGE_STATUSES: Record<
	string,
	"default" | "processing" | "success" | "error" | "warning"
> = {
	draft: "default",
	pending_review: "warning",
	published: "success",
	paused: "processing",
	expired: "error",
	closed: "error",
	archived: "default",
};

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

	const hasManageRole =
		myInfo?.roles?.includes("org:manage_openings") ||
		myInfo?.roles?.includes("org:superadmin");

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
			if (response.status === 204) return { status: response.status };
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
					if (paginationKey) {
						setOpenings((prev) => [
							...prev,
							...(response.data?.openings ?? []),
						]);
					} else {
						setOpenings(response.data.openings);
					}
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
						{ opening_number: openingNumber }
					);
					if (response.status === 204) {
						message.success(t("success.discarded"));
						void fetchOpenings();
					}
				} catch {
					message.error(t("errors.transitionFailed"));
				}
			},
		});
	};

	const handleTransition = async (
		path: string,
		openingNumber: number,
		successKey: string
	) => {
		try {
			const response = await postOpeningAction<unknown>(path, {
				opening_number: openingNumber,
			});
			if (response.status === 200 || response.status === 204) {
				message.success(t(`success.${successKey}`));
				void fetchOpenings();
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
						{ opening_number: openingNumber, rejection_note: note }
					);
					if (response.status === 200) {
						message.success(t("success.rejected"));
						void fetchOpenings();
					}
				} catch {
					message.error(t("errors.transitionFailed"));
				}
			},
		});
	};

	const handleDuplicate = async (openingNumber: number) => {
		try {
			const response = await postOpeningAction<CreateOpeningResponse>(
				"/org/duplicate-opening",
				{ opening_number: openingNumber }
			);
			if (response.status === 201 && response.data) {
				message.success(t("success.duplicated"));
				navigate(`/openings/${response.data.opening_number}/edit`);
			}
		} catch {
			message.error(t("errors.transitionFailed"));
		}
	};

	const getActionMenuItems = (record: OpeningSummary): MenuProps["items"] => {
		const viewItem = {
			key: "view",
			label: t("table.view"),
			onClick: () => navigate(`/openings/${record.opening_number}`),
		};
		const duplicateItem = {
			key: "duplicate",
			label: t("table.duplicate"),
			onClick: () => handleDuplicate(record.opening_number),
		};
		const editItem = {
			key: "edit",
			label: t("table.edit"),
			onClick: () => navigate(`/openings/${record.opening_number}/edit`),
		};
		const submitItem = {
			key: "submit",
			label: t("table.submit"),
			onClick: () =>
				handleTransition(
					"/org/submit-opening",
					record.opening_number,
					"submitted"
				),
		};
		const approveItem = {
			key: "approve",
			label: t("table.approve"),
			onClick: () =>
				handleTransition(
					"/org/approve-opening",
					record.opening_number,
					"approved"
				),
		};
		const rejectItem = {
			key: "reject",
			label: t("table.reject"),
			onClick: () => handleRejectModal(record.opening_number),
		};
		const pauseItem = {
			key: "pause",
			label: t("table.pause"),
			onClick: () =>
				handleTransition("/org/pause-opening", record.opening_number, "paused"),
		};
		const reopenItem = {
			key: "reopen",
			label: t("table.reopen"),
			onClick: () =>
				handleTransition(
					"/org/reopen-opening",
					record.opening_number,
					"reopened"
				),
		};
		const closeItem = {
			key: "close",
			label: t("table.close"),
			onClick: () =>
				handleTransition("/org/close-opening", record.opening_number, "closed"),
		};
		const archiveItem = {
			key: "archive",
			label: t("table.archive"),
			onClick: () =>
				handleTransition(
					"/org/archive-opening",
					record.opening_number,
					"archived"
				),
		};
		const discardItem = {
			key: "discard",
			label: t("table.discard"),
			danger: true,
			onClick: () => handleDiscard(record.opening_number),
		};

		if (!hasManageRole) return [viewItem];

		const actionsByStatus: Record<string, MenuProps["items"]> = {
			draft: [
				viewItem,
				editItem,
				submitItem,
				duplicateItem,
				{ type: "divider" },
				discardItem,
			],
			pending_review: [viewItem, approveItem, rejectItem, duplicateItem],
			published: [viewItem, pauseItem, closeItem, duplicateItem],
			paused: [viewItem, reopenItem, closeItem, duplicateItem],
			expired: [viewItem, archiveItem, duplicateItem],
			closed: [viewItem, archiveItem, duplicateItem],
			archived: [viewItem, duplicateItem],
		};

		return actionsByStatus[record.status as string] ?? [viewItem];
	};

	const columns = [
		{
			title: t("table.openingNumber"),
			dataIndex: "opening_number",
			key: "opening_number",
			width: 60,
			render: (num: number) => (
				<span style={{ color: "#8c8c8c", fontFamily: "monospace" }}>
					#{num}
				</span>
			),
		},
		{
			title: t("table.title"),
			dataIndex: "title",
			key: "title",
			render: (title: string, record: OpeningSummary) => (
				<Button
					type="link"
					style={{ padding: 0, textAlign: "left", height: "auto" }}
					onClick={() => navigate(`/openings/${record.opening_number}`)}
				>
					{title}
				</Button>
			),
		},
		{
			title: t("table.status"),
			dataIndex: "status",
			key: "status",
			width: 140,
			render: (status: OpeningStatus) => (
				<Badge
					status={STATUS_BADGE_STATUSES[status] ?? "default"}
					text={
						<Tag color={STATUS_TAG_COLORS[status]}>{t(`status.${status}`)}</Tag>
					}
				/>
			),
		},
		{
			title: t("table.visibility"),
			dataIndex: "is_internal",
			key: "is_internal",
			width: 90,
			render: (is_internal: boolean) => (
				<Tag color={is_internal ? "blue" : "cyan"}>
					{is_internal
						? t("filter.visibilityInternal")
						: t("filter.visibilityPublic")}
				</Tag>
			),
		},
		{
			title: t("table.employmentType"),
			dataIndex: "employment_type",
			key: "employment_type",
			width: 110,
			render: (type: string) => t(`form.${type}`),
		},
		{
			title: t("table.positions"),
			key: "positions",
			width: 90,
			render: (_: unknown, record: OpeningSummary) => (
				<span>
					<strong>{record.filled_positions}</strong>
					<span style={{ color: "#8c8c8c" }}>
						/{record.number_of_positions}
					</span>
				</span>
			),
		},
		{
			title: t("table.hiringManager"),
			dataIndex: ["hiring_manager", "full_name"],
			key: "hiring_manager",
			width: 140,
			ellipsis: true,
		},
		{
			title: t("table.createdAt"),
			dataIndex: "created_at",
			key: "created_at",
			width: 130,
			render: (date: string) => formatDateTime(date, i18n.language),
		},
		{
			title: t("table.actions"),
			key: "actions",
			fixed: "right" as const,
			width: 110,
			render: (_: unknown, record: OpeningSummary) => (
				<Dropdown
					menu={{ items: getActionMenuItems(record) }}
					trigger={["click"]}
				>
					<Button size="small">
						<Space>
							{t("table.actions")}
							<DownOutlined />
						</Space>
					</Button>
				</Dropdown>
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
					scroll={{ x: 900 }}
					locale={{
						emptyText: (
							<Empty
								description={
									<span>
										{t("errors.loadFailed", {
											defaultValue: "No openings yet.",
										})}
										{hasManageRole && (
											<>
												{" "}
												<Button
													type="link"
													style={{ padding: 0 }}
													onClick={() => navigate("/openings/new")}
												>
													{t("createOpening")}
												</Button>
											</>
										)}
									</span>
								}
							/>
						),
					}}
				/>
				{pagination.next_pagination_key && !loading && (
					<div style={{ textAlign: "center", marginTop: 16 }}>
						<Button
							onClick={() => fetchOpenings(pagination.next_pagination_key)}
						>
							{t("table.loadMore")}
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
}
