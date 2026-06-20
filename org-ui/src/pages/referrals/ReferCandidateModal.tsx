import React, { useState } from "react";
import { Form, Input, Modal, App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import type { ReferCandidateRequest } from "vetchium-specs/org/agency-referrals";
import { validateReferCandidateRequest } from "vetchium-specs/org/agency-referrals";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

interface Props {
	openingId: string;
	open: boolean;
	onClose: () => void;
	onReferred: () => void;
}

const ReferCandidateModal: React.FC<Props> = ({
	openingId,
	open,
	onClose,
	onReferred,
}) => {
	const { t } = useTranslation("agencyReferrals");
	const { sessionToken } = useAuth();
	const { message } = AntApp.useApp();
	const [submitting, setSubmitting] = useState(false);
	const [form] = Form.useForm();

	const onFinish = async (values: {
		candidate_handle: string;
		statement_text?: string;
	}) => {
		if (!sessionToken) return;
		const req: ReferCandidateRequest = {
			opening_id: openingId,
			candidate_handle: values.candidate_handle,
			statement_text: values.statement_text || undefined,
		};
		const errs = validateReferCandidateRequest(req);
		if (errs.length > 0) {
			message.error(errs[0]?.message ?? t("errGeneric"));
			return;
		}
		setSubmitting(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const res = await fetch(`${baseUrl}/org/refer-candidate`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 201) {
				message.success(t("referSuccess"));
				form.resetFields();
				onReferred();
				onClose();
			} else if (res.status === 403) {
				message.error(t("errNotAssigned"));
			} else if (res.status === 404) {
				message.error(t("errCandidateNotFound"));
			} else if (res.status === 409) {
				message.error(t("errDuplicate"));
			} else if (res.status === 422) {
				message.error(t("errOpeningNotPublished"));
			} else {
				message.error(t("errGeneric"));
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Modal
			open={open}
			title={t("referCandidate")}
			okText={t("refer")}
			cancelText={t("cancel")}
			confirmLoading={submitting}
			onOk={() => form.submit()}
			onCancel={() => {
				form.resetFields();
				onClose();
			}}
			destroyOnHidden
		>
			<Form form={form} layout="vertical" onFinish={onFinish}>
				<Form.Item
					name="candidate_handle"
					label={t("candidateHandle")}
					rules={[{ required: true }]}
				>
					<Input prefix="@" placeholder={t("candidateHandlePlaceholder")} />
				</Form.Item>
				<Form.Item name="statement_text" label={t("statement")}>
					<Input.TextArea maxLength={2000} rows={4} />
				</Form.Item>
			</Form>
		</Modal>
	);
};

export default ReferCandidateModal;
