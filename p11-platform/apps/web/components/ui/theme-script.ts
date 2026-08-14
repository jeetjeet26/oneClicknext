export const THEME_STORAGE_KEY = 'theme'

export const themeBootstrapScript = `(() => {
  try {
    const root = document.documentElement;
    const stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    const theme = stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : 'system';
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.dataset.theme = theme;
    root.style.colorScheme = resolved;
  } catch {
    document.documentElement.classList.add('light');
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';
  }
})();`
