export type AppTheme = "dark" | "light";

export function applyAppTheme(theme: string) {
  const resolved: AppTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
