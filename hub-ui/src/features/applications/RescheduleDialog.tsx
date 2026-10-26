import { Form, Input, Modal } from "antd";
import { useTranslation } from "react-i18next";
import {
  isInterviewRescheduleNote,
  maxRescheduleNote,
} from "typespec/orgs/applications/applications";
import { ActionError } from "./ActionError";

interface RescheduleForm {
  note: string;
}

export function RescheduleDialog({
  open,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<RescheduleForm>();
  return (
    <Modal
      open={open}
      title={t("applications.reschedule.title")}
      okText={t("applications.reschedule.send")}
      cancelText={t("common.cancel")}
      confirmLoading={pending}
      onOk={() => form.submit()}
      onCancel={onCancel}
      afterClose={() => form.resetFields()}
      destroyOnHidden
    >
      <Form<RescheduleForm>
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(values.note.trim())}
      >
        <Form.Item
          name="note"
          label={t("applications.reschedule.note")}
          extra={t("applications.reschedule.help")}
          rules={[
            {
              validator: async (_, value: string | undefined) => {
                if (!isInterviewRescheduleNote((value ?? "").trim())) {
                  throw new Error(t("applications.reschedule.invalid"));
                }
              },
            },
          ]}
        >
          <Input.TextArea
            rows={4}
            maxLength={maxRescheduleNote}
            showCount
            autoFocus
          />
        </Form.Item>
      </Form>
      <ActionError error={error} />
    </Modal>
  );
}
