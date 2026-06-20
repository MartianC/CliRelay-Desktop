import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { DesktopLocale } from "../bridge/types";
import { useSettingsStore } from "../stores/settingsStore";
import { tForLocale, type MessageKey } from "./locales";

interface I18nContextValue {
  locale: DesktopLocale;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: (key) => tForLocale("zh-CN", key),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const settings = useSettingsStore();
  const locale = settings.settings?.locale ?? "zh-CN";
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key) => tForLocale(locale, key),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
