const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

export const plainStyle = createStyle(false);

export function styleForStream(stream = process.stdout, env = process.env) {
  return createStyle(Boolean(stream?.isTTY) && !env.NO_COLOR);
}

export function createStyle(enabled) {
  const wrap = (code, text) => enabled ? `${code}${text}${ANSI.reset}` : text;
  return {
    enabled,
    heading: (text) => wrap(`${ANSI.bold}${ANSI.cyan}`, text),
    label: (text) => wrap(ANSI.bold, text),
    muted: (text) => wrap(ANSI.dim, text),
    value: (text) => wrap(ANSI.green, text),
    accent: (text) => wrap(ANSI.cyan, text),
    warning: (text) => wrap(ANSI.yellow, text),
    error: (text) => wrap(ANSI.red, text),
    profile: (text) => wrap(`${ANSI.bold}${ANSI.magenta}`, text),
  };
}
