import { EditOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  App,
  Avatar,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Typography,
  theme,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ContactNote,
  isNoteText,
  maxNoteLength,
} from "typespec/orgs/marketplace/contacts/contacts";
import { isDefiniteRefusal } from "../../api/client";
import { getInitials } from "./presentation";
import { chatRequestProblem } from "./problems";
import {
  useAddContactNoteMutation,
  useAddPersonNoteMutation,
  useContactNotesQuery,
  useEditContactNoteMutation,
} from "./queries";

const codePoints = (value: string) => Array.from(value).length;

function NoteCard({ handle, note }: { handle: string; note: ContactNote }) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const editKey = useIdempotencyKey("edit-contact-note");
  const edit = useEditContactNoteMutation(handle);
  const [editing, setEditing] = useState<string>();

  const save = async () => {
    if (editing === undefined || !isNoteText(editing)) return;
    try {
      await edit.mutateAsync({
        request: {
          handle,
          note_number: note.note_number,
          text: editing.trim(),
        },
        key: editKey.current(),
      });
      editKey.rotate();
      message.success(t("marketplace.contacts.noteEditedSuccess"));
      setEditing(undefined);
    } catch (error) {
      if (isDefiniteRefusal(error)) editKey.rotate();
      message.error(t("marketplace.contacts.noteEditedError"));
    }
  };

  return (
    <Card size="small">
      <Flex vertical gap="small">
        <Flex justify="space-between" align="center" wrap="wrap" gap="small">
          <Flex align="center" gap="small" wrap="wrap">
            <Avatar size="small" aria-hidden>
              {getInitials(note.author)}
            </Avatar>
            <Typography.Text strong>{note.author}</Typography.Text>
            <Typography.Text type="secondary">
              {dateTime(note.created_at)}
              {note.edited_at !== undefined &&
                ` · ${t("marketplace.contacts.noteEdited")}`}
            </Typography.Text>
          </Flex>
          {note.mine && editing === undefined && (
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing(note.text)}
            >
              {t("actions.edit")}
            </Button>
          )}
        </Flex>
        {editing === undefined ? (
          <Typography.Paragraph style={{ whiteSpace: "pre-line", margin: 0 }}>
            {note.text}
          </Typography.Paragraph>
        ) : (
          <Flex vertical gap="small">
            <Input.TextArea
              rows={3}
              aria-label={t("actions.edit")}
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
              count={{ show: true, max: maxNoteLength, strategy: codePoints }}
            />
            <Flex
              justify="flex-end"
              gap="small"
              style={{ marginTop: token.marginMD }}
            >
              <Button size="small" onClick={() => setEditing(undefined)}>
                {t("actions.cancel")}
              </Button>
              <Button
                size="small"
                type="primary"
                disabled={!isNoteText(editing)}
                loading={edit.isPending}
                onClick={() => void save()}
              >
                {t("actions.save")}
              </Button>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Card>
  );
}

/** The agency's notes on a person (MKT-NOTE). Notes are kept for the
 * agency's later searches, so none is ever deleted by hand. */
export function ContactNotes({
  handle,
  name,
  isContact,
}: {
  handle: string;
  name: string;
  isContact: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const addKey = useIdempotencyKey("add-contact-note");
  const notesQuery = useContactNotesQuery(handle, isContact);
  const notes = (notesQuery.data?.pages ?? []).flatMap((page) => page.items);
  const addContactNote = useAddContactNoteMutation(handle);
  const addPersonNote = useAddPersonNoteMutation();
  const adding = addContactNote.isPending || addPersonNote.isPending;
  const [text, setText] = useState("");

  const add = async () => {
    if (!isNoteText(text)) return;
    try {
      const key = addKey.current();
      if (isContact) {
        await addContactNote.mutateAsync({
          request: { handle, text: text.trim() },
          key,
        });
      } else {
        await addPersonNote.mutateAsync({
          request: { address: handle, text: text.trim() },
          key,
        });
      }
      addKey.rotate();
      message.success(t("marketplace.contacts.noteAddedSuccess"));
      setText("");
    } catch (error) {
      if (isDefiniteRefusal(error)) addKey.rotate();
      const problem = chatRequestProblem(error);
      message.error(
        problem === undefined
          ? t("marketplace.contacts.noteAddedError")
          : t(`marketplace.chatRequests.problems.${problem}`),
      );
    }
  };

  return (
    <Flex vertical gap="middle">
      <Card size="small">
        <Flex vertical gap="small">
          <Input.TextArea
            rows={3}
            aria-label={t("marketplace.contacts.notePlaceholder")}
            placeholder={t("marketplace.contacts.notePlaceholder")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            count={{ show: true, max: maxNoteLength, strategy: codePoints }}
          />
          {/* The code-point count sits under the text area. */}
          <Flex
            justify="space-between"
            align="center"
            wrap="wrap"
            gap="small"
            style={{ marginTop: token.marginMD }}
          >
            <Typography.Text type="secondary" style={{ flex: 1 }}>
              {t("marketplace.contacts.notesPrivacySubtitle", { name })}
            </Typography.Text>
            <Button
              type="primary"
              disabled={!isNoteText(text)}
              loading={adding}
              onClick={() => void add()}
            >
              {t("marketplace.contacts.addNote")}
            </Button>
          </Flex>
        </Flex>
      </Card>
      {notes.length === 0 && !notesQuery.isLoading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            isContact
              ? t("marketplace.contacts.noNotesYet")
              : t("marketplace.contacts.noNotesExplainer", { name })
          }
        />
      ) : (
        notes.map((note) => (
          <NoteCard key={note.note_number} handle={handle} note={note} />
        ))
      )}
      {notesQuery.hasNextPage && (
        <Button
          loading={notesQuery.isFetchingNextPage}
          onClick={() => void notesQuery.fetchNextPage()}
          style={{ alignSelf: "center" }}
        >
          {t("marketplace.contacts.moreNotes")}
        </Button>
      )}
    </Flex>
  );
}
