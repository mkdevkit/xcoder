import { useCallback } from "react";
import { useSettingsStore } from "../stores/settings";
import { translate } from "./locales";
import type { AppLocale, TranslationKey } from "./types";

export function useTranslation() {
  const locale = useSettingsStore((state) => state.locale);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string>) =>
      translate(locale, key, params),
    [locale],
  );

  return { t, locale };
}

export function localeLabel(locale: AppLocale) {
  return translate(locale, `lang.${locale}` as TranslationKey);
}
