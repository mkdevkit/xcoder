import { useCallback } from "react";
import { useSettingsStore } from "../stores/settings";
import { translate } from "./locales";
import type { AppLocale, TranslationKey } from "./types";

/** Non-React i18n helper (stores, utils). */
export function t(key: TranslationKey, params?: Record<string, string>) {
  return translate(useSettingsStore.getState().locale, key, params);
}

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
