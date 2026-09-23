import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Flex, Select, Spin, Typography } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  type LanguageAbility,
  type LanguageTag,
  languageCatalog,
  type PublicProfile,
  Reading,
  Speaking,
  Writing,
} from "typespec/hub/profile/public";
import { hubAPI } from "../../api/hub";
import { useIdempotencyKey } from "../../api/idempotency";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { myInfoQueryKey, usePublicProfileQuery } from "./queries";

const languageLimit = 25;
const abilities: readonly LanguageAbility[] = [Speaking, Reading, Writing];

function languageLabel(tag: LanguageTag, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** PROF-LAN-006: displayed and offered alphabetically by localized CLDR name. */
function sortedByLabel<Entry extends { label: string }>(
  entries: Entry[],
  locale: string,
): Entry[] {
  const collator = new Intl.Collator(locale);
  return [...entries].sort((a, b) => collator.compare(a.label, b.label));
}

function AbilitySection({
  address,
  ability,
  tags,
}: {
  address: string;
  ability: LanguageAbility;
  tags: LanguageTag[];
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const addKey = useIdempotencyKey();
  const removeKey = useIdempotencyKey();
  const locale = i18n.language;
  const options = useMemo(
    () =>
      sortedByLabel(
        languageCatalog.map((tag) => ({
          value: tag,
          label: languageLabel(tag, locale),
        })),
        locale,
      ),
    [locale],
  );
  const value = useMemo(
    () =>
      sortedByLabel(
        tags.map((tag) => ({ tag, label: languageLabel(tag, locale) })),
        locale,
      ).map((entry) => entry.tag),
    [tags, locale],
  );

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: myInfoQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["hub", "profile", address] }),
    ]);

  const add = useMutation({
    mutationFn: (language_tag: LanguageTag) =>
      hubAPI.addLanguageAbility({ ability, language_tag }, addKey.current()),
    onSuccess: async () => {
      addKey.rotate();
      await invalidate();
      void message.success(t("profileLanguages.added"));
    },
  });
  const remove = useMutation({
    mutationFn: (language_tag: LanguageTag) =>
      hubAPI.deleteLanguageAbility(
        { ability, language_tag },
        removeKey.current(),
      ),
    onSuccess: async () => {
      removeKey.rotate();
      await invalidate();
      void message.success(t("profileLanguages.removed"));
    },
  });
  const busy = add.isPending || remove.isPending;
  const abilityLabel = t(`profileLanguages.abilities.${ability}`);

  const handleChange = (next: LanguageTag[]) => {
    const current = new Set(tags);
    const nextSet = new Set(next);
    const added = next.find((tag) => !current.has(tag));
    if (added !== undefined) {
      add.mutate(added);
      return;
    }
    const removed = tags.find((tag) => !nextSet.has(tag));
    if (removed !== undefined) remove.mutate(removed);
  };

  return (
    <div>
      <Flex justify="space-between" align="baseline">
        <Typography.Title level={5} style={{ marginBottom: 4 }}>
          {abilityLabel}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("profileLanguages.count", {
            count: tags.length,
            limit: languageLimit,
          })}
        </Typography.Text>
      </Flex>
      <Select<LanguageTag[]>
        mode="multiple"
        style={{ width: "100%" }}
        aria-label={abilityLabel}
        placeholder={t("profileLanguages.selectPlaceholder")}
        showSearch
        optionFilterProp="label"
        disabled={busy}
        maxCount={languageLimit}
        maxTagCount="responsive"
        value={value}
        options={options}
        onChange={handleChange}
      />
      <APIErrorAlert error={add.error ?? remove.error} />
    </div>
  );
}

function LanguageAbilitiesListCard({
  address,
  profile,
}: {
  address: string;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const byAbility = (ability: LanguageAbility) =>
    profile.language_abilities
      .filter((entry) => entry.ability === ability)
      .map((entry) => entry.language_tag);

  return (
    <Card title={t("profileLanguages.title")}>
      <Flex vertical gap="large">
        {abilities.map((ability) => (
          <AbilitySection
            key={ability}
            address={address}
            ability={ability}
            tags={byAbility(ability)}
          />
        ))}
      </Flex>
    </Card>
  );
}

export function LanguageAbilitiesCard({ address }: { address: string }) {
  const { t } = useTranslation();
  const profile = usePublicProfileQuery(address);
  if (profile.isPending) {
    return (
      <Card title={t("profileLanguages.title")}>
        <Spin aria-label={t("profileLanguages.loading")} />
      </Card>
    );
  }
  if (profile.isError) {
    return (
      <Card title={t("profileLanguages.title")}>
        <APIErrorAlert error={profile.error} />
        <Button onClick={() => void profile.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  return <LanguageAbilitiesListCard address={address} profile={profile.data} />;
}
