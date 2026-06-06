import React, { useEffect, useState } from "react";
import {
	Button,
	DatePicker,
	Form,
	Input,
	Modal,
	Select,
	Spin,
	Typography,
	message,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ScheduleInterviewRequest } from "vetchium-specs/org/interviews";
import type {
	ListOrgUsersRequest,
	ListOrgUsersResponse,
} from "vetchium-specs/org/org-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import dayjs from "dayjs";

const { Title } = Typography;
const { TextArea } = Input;

export const ScheduleInterviewPage: React.FC = () => {
	const { t } = useTranslation("interviews");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { candidacyId } = useParams<{ candidacyId: string }>();
	const [form] = Form.useForm();
	const [submitting, setSubmitting] = useState(false);
	// Suggestions for the interviewer recipient input. Loaded best-effort: a user
	// who can schedule interviews may not have the view_users role, in which case
	// the request 403s and the field still works as a free-entry chip input.
	const [userOptions, setUserOptions] = useState<
		{ value: string; label: string }[]
	>([]);

	useEffect(() => {
		const loadUsers = async () => {
			if (!sessionToken) return;
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const req: ListOrgUsersRequest = { limit: 100 };
				const res = await fetch(`${apiBaseUrl}/org/list-users`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (res.status === 200) {
					const data = (await res.json()) as ListOrgUsersResponse;
					setUserOptions(
						data.users.map((u) => ({
							value: u.email_address,
							label: u.name
								? `${u.name} <${u.email_address}>`
								: u.email_address,
						}))
					);
				}
			} catch {
				// best-effort only
			}
		};
		loadUsers();
	}, [sessionToken]);

	const doSubmit = async (values: {
		interview_type: string;
		starts_at: ReturnType<typeof dayjs>;
		ends_at: ReturnType<typeof dayjs>;
		description?: string;
		interview_location?: string;
		interviewer_emails: string[];
	}) => {
		if (!sessionToken || !candidacyId) return;
		setSubmitting(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: ScheduleInterviewRequest = {
				candidacy_id: candidacyId,
				interview_type:
					values.interview_type as ScheduleInterviewRequest["interview_type"],
				starts_at: values.starts_at.toISOString(),
				ends_at: values.ends_at.toISOString(),
				...(values.description ? { description: values.description } : {}),
				...(values.interview_location
					? { interview_location: values.interview_location }
					: {}),
				interviewer_email_addresses: values.interviewer_emails,
			};
			const res = await fetch(`${apiBaseUrl}/org/schedule-interview`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 201) {
				message.success(t("scheduleSuccess"));
				navigate(`/candidacies/${candidacyId}`);
			} else if (res.status === 400) {
				// The body may be a JSON array of validation errors OR a plain-text
				// message (e.g. "interviewer not found: x@y.com"). Surface both so a
				// bad interviewer email is never swallowed silently (#13).
				const textBody = await res.text();
				let shown = false;
				try {
					const parsed = JSON.parse(textBody);
					if (Array.isArray(parsed)) {
						parsed.forEach((e: { message: string }) =>
							message.error(e.message)
						);
						shown = true;
					}
				} catch {
					// not JSON
				}
				if (!shown) message.error(textBody || t("scheduleFailed"));
			} else if (res.status === 422) {
				message.error(t("notInterviewing"));
			} else if (res.status === 404) {
				message.error(t("candidacyNotFound"));
			} else {
				message.error(t("scheduleFailed"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	const handleSubmit = async (values: {
		interview_type: string;
		starts_at: ReturnType<typeof dayjs>;
		ends_at: ReturnType<typeof dayjs>;
		description?: string;
		interview_location?: string;
		interviewer_emails: string[];
	}) => {
		const emails = values.interviewer_emails ?? [];
		if (emails.length < 1 || emails.length > 5) {
			message.error(t("interviewersCount"));
			return;
		}
		// Future-only by default, with an explicit confirmation escape hatch for
		// scheduling in the past (#11).
		if (values.starts_at && values.starts_at.isBefore(dayjs())) {
			Modal.confirm({
				title: t("pastTitle"),
				content: t("pastContent"),
				okText: t("pastConfirm"),
				cancelText: t("cancel"),
				onOk: () => doSubmit(values),
			});
			return;
		}
		doSubmit(values);
	};

	// When the start time changes, default the end time to one hour later. The
	// user can still override the end time afterwards (#11).
	const handleStartChange = (value: ReturnType<typeof dayjs> | null) => {
		if (value) {
			form.setFieldValue("ends_at", value.add(1, "hour"));
		}
	};

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 600,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to={`/candidacies/${candidacyId}`}>
					<Button icon={<ArrowLeftOutlined />}>{t("backToCandidacy")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("scheduleTitle")}
			</Title>

			<Spin spinning={submitting}>
				<Form form={form} layout="vertical" onFinish={handleSubmit}>
					<Form.Item
						name="interview_type"
						label={t("interviewType")}
						rules={[{ required: true }]}
					>
						<Select
							options={[
								{ value: "in_person", label: t("in_person") },
								{ value: "video", label: t("video") },
								{ value: "take_home", label: t("take_home") },
								{ value: "other", label: t("other") },
							]}
						/>
					</Form.Item>

					<Form.Item
						name="starts_at"
						label={t("startsAt")}
						rules={[{ required: true }]}
					>
						<DatePicker
							showTime
							style={{ width: "100%" }}
							onChange={handleStartChange}
						/>
					</Form.Item>

					<Form.Item
						name="ends_at"
						label={t("endsAt")}
						rules={[{ required: true }]}
						extra={t("endsAtHelp")}
					>
						<DatePicker showTime style={{ width: "100%" }} />
					</Form.Item>

					<Form.Item
						name="interview_location"
						label={t("location")}
						extra={t("locationHelp")}
					>
						<Input maxLength={2000} placeholder={t("locationPlaceholder")} />
					</Form.Item>

					<Form.Item name="description" label={t("description")}>
						<TextArea rows={3} maxLength={2000} />
					</Form.Item>

					<Form.Item
						name="interviewer_emails"
						label={t("interviewers")}
						rules={[{ required: true }]}
						extra={t("interviewersHelp")}
					>
						<Select
							mode="tags"
							tokenSeparators={[",", " ", "\n", ";"]}
							options={userOptions}
							placeholder={t("interviewersPlaceholder")}
							maxCount={5}
							showSearch={{ optionFilterProp: "label" }}
						/>
					</Form.Item>

					<Form.Item>
						<Button type="primary" htmlType="submit" loading={submitting}>
							{t("schedule")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
};
