export const colors = {
  // Primary brand colors
  primary: '#58A6FF',           // Bright blue - main accent
  primaryLight: '#a5cfff',      // Light blue for highlights
  primaryDark: '#1f6feb',       // Dark blue for contrast

  // Status colors
  success: '#3fb950',           // Vibrant green
  error: '#f85149',             // Bright red
  warning: '#d29922',           // Warm yellow/gold
  info: '#6CB6FF',              // Info blue

  // Financial colors
  positive: '#3fb950',          // Green for gains/positive changes
  negative: '#f85149',          // Red for losses/negative changes
  neutral: '#8b949e',           // Gray for neutral/unchanged

  // Text colors
  white: '#ffffff',
  muted: '#8b949e',             // Slightly brighter muted
  mutedDark: '#484f58',         // Dark gray for subtle elements

  // Background colors
  queryBg: '#21262d',           // Query background (darker)
  headerBg: '#161b22',          // Header background
  tableBorder: '#30363d',       // Table border color

  // Accent colors for fun!
  accent: '#58a6ff',            // Cyan accent
  highlight: '#a371f7',         // Purple highlight
  gold: '#e3b341',              // Gold for special highlights
  orange: '#db6d28',            // Orange for warnings
  pink: '#f778ba',              // Pink for emphasis
  teal: '#2ea043',              // Teal for alternative accent

  // Brand
  claude: '#E5896A',            // Claude branding color
  dexter: '#58A6FF',            // Dexter branding color
} as const;

export const dimensions = {
  boxWidth: 80,
  introWidth: 50,
} as const;

// Fun symbols and decorations
export const symbols = {
  bullet: '●',
  diamond: '◆',
  arrow: '→',
  arrowUp: '↑',
  arrowDown: '↓',
  star: '★',
  sparkle: '✦',
  check: '✓',
  cross: '✗',
  circle: '○',
  square: '□',
  triangleUp: '▲',
  triangleDown: '▼',
  lightning: '⚡',
  fire: '🔥',
  chart: '📈',
  chartDown: '📉',
  money: '💰',
  rocket: '🚀',
  warning: '⚠️',
  info: 'ℹ️',
} as const;

