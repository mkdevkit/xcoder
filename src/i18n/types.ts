export type AppLocale =
  | "zh"
  | "en"
  | "ja"
  | "fr"
  | "de"
  | "ru"
  | "es"
  | "pt"
  | "it";

export const APP_LOCALES: AppLocale[] = [
  "zh",
  "en",
  "ja",
  "fr",
  "de",
  "ru",
  "es",
  "pt",
  "it",
];

export type TranslationKey =
  | "menu.file"
  | "menu.openProject"
  | "menu.config"
  | "menu.openConfigDir"
  | "menu.openConfigFile"
  | "menu.openOpencode"
  | "menu.openCodewhale"
  | "menu.preferences"
  | "menu.terminal"
  | "menu.newTerminal"
  | "panel.explorer"
  | "panel.preferences"
  | "editor.empty"
  | "editor.close"
  | "preferences.title"
  | "preferences.language"
  | "preferences.languageHint"
  | "preferences.appearance"
  | "preferences.appearanceHint"
  | "explorer.empty"
  | "explorer.noFolder"
  | "chat.connect"
  | "chat.disconnect"
  | "chat.restart"
  | "chat.send"
  | "chat.sending"
  | "chat.newSession"
  | "chat.deleteSession"
  | "chat.selectSession"
  | "chat.noSessions"
  | "chat.openFolderFirst"
  | "chat.openFolderToChat"
  | "chat.connectFirst"
  | "chat.selectOrCreateSession"
  | "chat.inputPlaceholder"
  | "chat.hintDisconnected"
  | "chat.hintNoSession"
  | "chat.hintReady"
  | "chat.deleteConfirm"
  | "chat.sessionFallback"
  | "terminal.title"
  | "terminal.new"
  | "terminal.close"
  | "terminal.exited"
  | "context.newFile"
  | "context.newFolder"
  | "context.refresh"
  | "context.openProjectFolder"
  | "context.rename"
  | "context.delete"
  | "context.copyPath"
  | "context.save"
  | "context.reload"
  | "context.revealInExplorer"
  | "context.closeTab"
  | "context.newTerminal"
  | "context.copy"
  | "context.copyWorkspacePath"
  | "browser.title"
  | "browser.p1"
  | "browser.p2"
  | "lang.zh"
  | "lang.en"
  | "lang.ja"
  | "lang.fr"
  | "lang.de"
  | "lang.ru"
  | "lang.es"
  | "lang.pt"
  | "lang.it";

export type TranslationTable = Record<TranslationKey, string>;
