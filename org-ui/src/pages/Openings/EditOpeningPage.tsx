import React, { useEffect, useState } from "react";
import {
	Form,
	Button,
	Input,
	Select,
	Checkbox,
	Card,
	Spin,
	message,
	InputNumber,
	Alert,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, Link } from "react-router-dom";
import type { Opening, UpdateOpeningRequest } from "vetchium-specs/org/openings";
import { OrgAPIClient } from "../../lib/org-api-client";
import { Title } from "antd/es/typography/Title";

export default function EditOpeningPage() {
	const { t } = useTranslation("openings");
	const navigate = useNavigate();
	const { openingNumber } = useParams<{ openingNumber: string }>();
	const [form] = Form.useForm();
	const [opening, setOpening] = useState<Opening | null>(null);
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [formErrors, setFormErrors] = useState<
		Array<{ field: string; message: string }>
	>([]);

	useEffect(() => {
		if (openingNumber) {
			fetchOpening();
		}
	}, [openingNumber]);

	const fetchOpening = async () => {
		setLoading(true);
		try {
			const api = new OrgAPIClient();
			const response = await api.getOpening({
				opening_number: parseInt(openingNumber || "0"),
			});
			if (response.status === 200) {
				setOpening(response.body);
				if (response.body.status !== "draft") {
					message.error(t("errors.notEditable"));
					setTimeout(() => navigate(`/openings/${openingNumber}`), 1500);
					return;
				}
				form.setFieldsValue({
					title: response.body.title,
					description: response.body.description,
					is_internal: response.body.is_internal,
					employment_type: response.body.employment_type,
					work_location_type: response.body.work_location_type,
					address_ids: response.body.addresses.map(
						(a) => a.address_id
					),
					min_yoe: response.body.min_yoe,
					max_yoe: response.body.max_yoe,
					min_education_level: response.body.min_education_level,
					salary_min: response.body.salary?.min_amount,
					salary_max: response.body.salary?.max_amount,
					salary_currency: response.body.salary?.currency,
					number_of_positions: response.body.number_of_positions,
					hiring_manager_org_user_id:
						response.body.hiring_manager.org_user_id,
					recruiter_org_user_id:
						response.body.recruiter.org_user_id,
					hiring_team_member_ids: response.body.hiring_team_members.map(
						(m) => m.org_user_id
					),
					watcher_ids: response.body.watchers.map(
						(w) => w.org_user_id
					),
					cost_center_id: response.body.cost_center?.cost_center_id,
					tag_ids: response.body.tags.map((tag) => tag.tag_id),
					internal_notes: response.body.internal_notes,
				});
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

	const onFinish = async (values: any) => {
		setSubmitting(true);
		setFormErrors([]);
		try {
			const req: UpdateOpeningRequest = {
				opening_number: parseInt(openingNumber || "0"),
				title: values.title,
				description: values.description,
				employment_type: values.employment_type,
				work_location_type: values.work_location_type,
				address_ids: values.address_ids || [],
				min_yoe: values.min_yoe,
				max_yoe: values.max_yoe,
				min_education_level: values.min_education_level,
				salary: values.salary_min
					? {
							min_amount: values.salary_min,
							max_amount: values.salary_max,
							currency: values.salary_currency,
						}
					: undefined,
				number_of_positions: values.number_of_positions,
				hiring_manager_org_user_id: values.hiring_manager_org_user_id,
				recruiter_org_user_id: values.recruiter_org_user_id,
				hiring_team_member_ids: values.hiring_team_member_ids,
				watcher_ids: values.watcher_ids,
				cost_center_id: values.cost_center_id,
				tag_ids: values.tag_ids,
				internal_notes: values.internal_notes,
			};

			const api = new OrgAPIClient();
			const response = await api.updateOpening(req);

			if (response.status === 200) {
				message.success(t("success.updated"));
				navigate(`/openings/${openingNumber}`);
			} else if (response.status === 422) {
				message.error(t("errors.notEditable"));
				setTimeout(() => navigate(`/openings/${openingNumber}`), 1500);
			} else if (response.status === 400) {
				const errors = response.body as Array<{
					field: string;
					message: string;
				}>;
				setFormErrors(errors);
				message.error(t("errors.saveFailed"));
			}
		} catch (error) {
			message.error(t("errors.saveFailed"));
		} finally {
			setSubmitting(false);
		}
	};

	const getFieldErrors = (fieldName: string) => {
		return formErrors.find((e) => e.field === fieldName)?.message;
	};

	const hasErrors = formErrors.length > 0;

	if (loading) {
		return (
			<Spin spinning={true} style={{ display: "flex", minHeight: 400 }} />
		);
	}

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

			<Title level={2} style={{ marginBottom: 24 }}>
				Edit Opening #{openingNumber}
			</Title>

			<Spin spinning={submitting}>
				<Form
					form={form}
					onFinish={onFinish}
					layout="vertical"
					autoComplete="off"
				>
					{/* Basics */}
					<Card title="Basics" style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.title")}
							name="title"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<Input
								maxLength={200}
								placeholder={t("form.title")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.description")}
							name="description"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<Input.TextArea
								maxLength={10000}
								rows={5}
								placeholder={t("form.description")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.isInternal")}
							name="is_internal"
							valuePropName="checked"
						>
							<Checkbox disabled>
								{t("form.isInternal")} (immutable)
							</Checkbox>
						</Form.Item>
					</Card>

					{/* Employment */}
					<Card title="Employment" style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.employmentType")}
							name="employment_type"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<Select
								placeholder={t("form.employmentType")}
								options={[
									{
										label: "Full-time",
										value: "full_time",
									},
									{
										label: "Part-time",
										value: "part_time",
									},
									{
										label: "Contract",
										value: "contract",
									},
									{
										label: "Internship",
										value: "internship",
									},
								]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.workLocationType")}
							name="work_location_type"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<Select
								placeholder={t("form.workLocationType")}
								options={[
									{
										label: "Remote",
										value: "remote",
									},
									{
										label: "On-Site",
										value: "on_site",
									},
									{
										label: "Hybrid",
										value: "hybrid",
									},
								]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.addresses")}
							name="address_ids"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<Select
								mode="multiple"
								placeholder={t("form.addresses")}
								options={[]}
							/>
						</Form.Item>
					</Card>

					{/* Requirements */}
					<Card title="Requirements" style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.minYoe")}
							name="min_yoe"
						>
							<InputNumber
								min={0}
								max={100}
								placeholder={t("form.minYoe")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.maxYoe")}
							name="max_yoe"
						>
							<InputNumber
								min={1}
								max={100}
								placeholder={t("form.maxYoe")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.minEducationLevel")}
							name="min_education_level"
						>
							<Select
								placeholder={t("form.minEducationLevel")}
								options={[
									{
										label: "Not Required",
										value: "not_required",
									},
									{
										label: "Bachelor",
										value: "bachelor",
									},
									{
										label: "Master",
										value: "master",
									},
									{
										label: "Doctorate",
										value: "doctorate",
									},
								]}
							/>
						</Form.Item>
					</Card>

					{/* Compensation */}
					<Card title="Compensation" style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.salaryMin")}
							name="salary_min"
						>
							<InputNumber
								min={0}
								placeholder={t("form.salaryMin")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.salaryMax")}
							name="salary_max"
						>
							<InputNumber
								min={0}
								placeholder={t("form.salaryMax")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.salaryCurrency")}
							name="salary_currency"
						>
							<Input
								maxLength={3}
								placeholder="USD"
							/>
						</Form.Item>
					</Card>

					{/* Team */}
					<Card title="Team" style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.hiringManager")}
							name="hiring_manager_org_user_id"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<Select
								placeholder={t("form.hiringManager")}
								options={[]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.recruiter")}
							name="recruiter_org_user_id"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<Select
								placeholder={t("form.recruiter")}
								options={[]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.hiringTeamMembers")}
							name="hiring_team_member_ids"
						>
							<Select
								mode="multiple"
								placeholder={t("form.hiringTeamMembers")}
								options={[]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.watchers")}
							name="watcher_ids"
						>
							<Select
								mode="multiple"
								placeholder={t("form.watchers")}
								options={[]}
							/>
						</Form.Item>
					</Card>

					{/* Cost Center & Tags */}
					<Card title="Additional" style={{ marginBottom: 16 }}>
						<Form.Item
							label={t("form.costCenter")}
							name="cost_center_id"
						>
							<Select
								placeholder={t("form.costCenter")}
								options={[]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.tags")}
							name="tag_ids"
						>
							<Select
								mode="multiple"
								placeholder={t("form.tags")}
								options={[]}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.internalNotes")}
							name="internal_notes"
						>
							<Input.TextArea
								maxLength={2000}
								rows={3}
								placeholder={t("form.internalNotes")}
							/>
						</Form.Item>

						<Form.Item
							label={t("form.numberOfPositions")}
							name="number_of_positions"
							rules={[
								{
									required: true,
									message: "Required",
								},
							]}
						>
							<InputNumber
								min={1}
								max={100}
								placeholder={t("form.numberOfPositions")}
							/>
						</Form.Item>
					</Card>

					{formErrors.length > 0 && (
						<Card
							style={{
								marginBottom: 16,
								borderColor: "#ff4d4f",
								backgroundColor: "#fff1f0",
							}}
						>
							{formErrors.map((error, idx) => (
								<div
									key={idx}
									style={{ color: "#ff4d4f" }}
								>
									{error.field}: {error.message}
								</div>
							))}
						</Card>
					)}

					<Form.Item>
						<Button
							type="primary"
							htmlType="submit"
							loading={submitting}
							disabled={hasErrors}
							block
						>
							{t("form.saveChanges")}
						</Button>
					</Form.Item>
				</Form>
			</Spin>
		</div>
	);
}
