// A reader for the YAML subset that the workflow files use: block maps and lists, plain and quoted
// scalars, flow lists and block scalars. The repository has no YAML package to import.
export type Yaml = string | boolean | null | Yaml[] | { [key: string]: Yaml };

const KEY = /^([\w./-]+|'[^']*'|"[^"]*"):(\s|$)/;

export function parseYaml(source: string): Yaml {
  const lines = source.split('\n');
  let at = 0;
  const indentOf = (line: string) => line.length - line.trimStart().length;
  const isItem = (line: string) => /^-(\s|$)/.test(line.trimStart());
  const skip = () => {
    while (at < lines.length && (!lines[at].trim() || lines[at].trimStart().startsWith('#'))) at++;
  };

  const block = (): Yaml => {
    skip();
    if (at >= lines.length) return null;
    return isItem(lines[at]) ? list(indentOf(lines[at])) : map(indentOf(lines[at]));
  };

  const list = (indent: number): Yaml[] => {
    const items: Yaml[] = [];
    for (skip(); at < lines.length; skip()) {
      const line = lines[at];
      if (indentOf(line) !== indent || !isItem(line)) break;
      const content = line.slice(indent + 1).trimStart();
      if (!content) {
        at++;
        items.push(block());
      } else if (KEY.test(content)) {
        const inner = line.length - content.length;
        lines[at] = ' '.repeat(inner) + content;
        items.push(map(inner));
      } else {
        at++;
        items.push(scalar(content));
      }
    }
    return items;
  };

  const map = (indent: number): { [key: string]: Yaml } => {
    const result: { [key: string]: Yaml } = {};
    for (skip(); at < lines.length; skip()) {
      const line = lines[at];
      if (indentOf(line) !== indent) break;
      const text = line.trim();
      const key = text.match(KEY);
      if (!key) throw new Error(`YAML line ${at + 1}: expected "key:" in ${JSON.stringify(text)}`);
      const value = text.slice(key[0].length).trim();
      at++;
      if (/^[|>]-?$/.test(value)) result[unquote(key[1])] = blockScalar(indent, value);
      else if (value) result[unquote(key[1])] = scalar(value);
      else {
        skip();
        const next = lines[at];
        const nested =
          next !== undefined &&
          (indentOf(next) > indent || (indentOf(next) === indent && isItem(next)));
        result[unquote(key[1])] = nested ? block() : null;
      }
    }
    return result;
  };

  const blockScalar = (indent: number, style: string): string => {
    const body: string[] = [];
    while (at < lines.length && (!lines[at].trim() || indentOf(lines[at]) > indent))
      body.push(lines[at++]);
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const margin = Math.min(...body.filter((l) => l.trim()).map(indentOf));
    const text = body.map((l) => l.slice(margin));
    const joined = style.startsWith('>') ? text.join(' ') : text.join('\n');
    return style.endsWith('-') ? joined : `${joined}\n`;
  };

  return block();
}

function unquote(text: string): string {
  if (text.startsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  if (text.startsWith('"')) return JSON.parse(text) as string;
  return text;
}

function scalar(text: string): Yaml {
  if (text.startsWith("'") || text.startsWith('"')) return unquote(text);
  if (text.startsWith('['))
    return text
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(scalar);
  const plain = text.replace(/\s+#.*$/, '');
  if (plain === 'true' || plain === 'false') return plain === 'true';
  return plain;
}
