/* Apply the persisted theme before first paint. Kept external for a strict CSP. */
try {
  const theme = localStorage.getItem('claude-ui-theme');
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch {
  // Storage can be unavailable in hardened/private browser contexts.
}
