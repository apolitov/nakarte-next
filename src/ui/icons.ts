// Line icons, 24×24, stroke = currentColor. Inner SVG markup.
export const ICONS = {
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  reverse: '<path d="M4 7h14l-3-3M20 17H6l3 3"/>',
  straight: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 17l10-10" stroke-dasharray="2 3"/>',
  checkpoint: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5" opacity=".7"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="4"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4M12 10v2l2 1"/>',
  logo: '<path d="M3 18l5-9 4 6 3-4 6 7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  file: '<path d="M14 3H6v18h12V7zM14 3v4h4"/>',
  climb: '<path d="M7 17L17 7M9 7h8v8"/>',
  loop: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>',
  outback: '<path d="M4 9h14l-3-3M18 9l-3 3M20 15H6l3-3M6 15l3 3"/>',
} as const;

export type IconName = keyof typeof ICONS;

export const isMac = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent,
  );

/** Label of the shortcut modifier: ⌘ on Apple, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';
