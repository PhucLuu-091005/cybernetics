const TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
export type PanelLevel = 2 | 3 | 4;
export const panelHeadings = (level: PanelLevel) =>
  ({ Title: TAGS[level - 1], Sub: TAGS[level] }) as const;
