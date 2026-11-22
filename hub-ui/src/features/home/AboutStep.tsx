import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Flex, Form, Input } from "antd";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeSetPublicFieldsRequest,
  type PublicProfile,
  type SetPublicFieldsRequest,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey } from "../profile/queries";
import { StepActions, type StepProps } from "./StepActions";

const biographyLimit = 2000;
const codePoints = (text: string) => Array.from(text).length;

export function AboutStep({
  address,
  profile,
  onAdvance,
  onSkip,
  onDirtyChange,
}: StepProps & { address: string; profile: PublicProfile }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const id = useId();
  const key = useIdempotencyKey();
  const lastPayload = useRef<string | null>(null);
  const saved = profile.biography ?? "";
  const [text, setText] = useState(saved);
  const [missing, setMissing] = useState(false);
  const dirty = text.trim() !== saved;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: (request: SetPublicFieldsRequest) => {
      const payload = JSON.stringify(request);
      if (lastPayload.current !== null && lastPayload.current !== payload) {
        key.rotate();
      }
      lastPayload.current = payload;
      return hubAPI.setPublicFields(request, key.current());
    },
    onSuccess: async (_, request) => {
      key.rotate();
      lastPayload.current = null;
      setText(request.biography ?? "");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["hub", "profile", address],
        }),
      ]);
      void message.success({ key: "setup", content: t("setup.saved") });
      onAdvance(Boolean(request.biography));
    },
  });

  const tooLong = codePoints(text) > biographyLimit;
  const error = tooLong
    ? t("profile.biographyTooLong")
    : missing
      ? t("setup.biographyMissing")
      : undefined;

  function submit() {
    if (tooLong || save.isPending) return;
    if (dirty) {
      // The request replaces both public fields, so the name goes unchanged.
      save.mutate(
        normalizeSetPublicFieldsRequest({
          display_name: profile.display_name,
          biography: text,
        }),
      );
    } else if (saved !== "") {
      onAdvance(true);
    } else {
      setMissing(true);
    }
  }

  return (
    <Form layout="vertical">
      <Form.Item
        label={t("profile.biography")}
        htmlFor={id}
        validateStatus={error === undefined ? undefined : "error"}
        help={error}
      >
        <div style={{ paddingBottom: 20 }}>
          <Input.TextArea
            id={id}
            aria-invalid={error !== undefined}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setMissing(false);
            }}
            autoSize={{ minRows: 3, maxRows: 10 }}
            count={{ show: true, max: biographyLimit, strategy: codePoints }}
          />
        </div>
      </Form.Item>
      <Flex vertical gap="middle">
        <APIErrorAlert error={save.error} />
        <StepActions
          label={t("setup.saveAndContinue")}
          onContinue={submit}
          onSkip={saved === "" ? onSkip : undefined}
          pending={save.isPending}
          dirty={dirty}
        />
      </Flex>
    </Form>
  );
}
