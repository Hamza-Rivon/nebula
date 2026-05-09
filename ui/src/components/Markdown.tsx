// Tiny regex-based markdown renderer.
// Supports: headings, bold, italic, inline code, fenced code, lists, links, paragraphs.

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; text: string };

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or EOF)
      blocks.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }
    // Heading
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      blocks.push({ type: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Paragraph (collect contiguous non-empty, non-special lines)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: buf.join(" ") });
  }
  return blocks;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(raw: string): string {
  let s = escapeHtml(raw);
  // inline code
  s = s.replace(/`([^`]+?)`/g, '<code class="nb-tag">$1</code>');
  // bold
  s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  // italic
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>");
  // links
  s = s.replace(
    /\[([^\]]+?)\]\(([^)]+?)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="underline decoration-2 underline-offset-2">$1</a>',
  );
  return s;
}

export function Markdown({ source }: { source: string }) {
  if (!source) return null;
  const blocks = parse(source);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === "h") {
          const sizes = ["text-xl", "text-lg", "text-base", "text-sm", "text-sm", "text-sm"];
          const cls = `font-display font-bold mt-2 ${sizes[b.level - 1] ?? "text-sm"}`;
          return (
            <div
              key={i}
              className={cls}
              dangerouslySetInnerHTML={{ __html: inline(b.text) }}
            />
          );
        }
        if (b.type === "code") {
          return (
            <pre
              key={i}
              className="scrollbar-soft overflow-auto rounded border-2 border-[var(--color-ink)] bg-[var(--color-mist)] p-2 font-mono text-xs"
            >
              {b.lang && (
                <div className="mb-1 text-[10px] font-bold uppercase tracking-widest opacity-60">
                  {b.lang}
                </div>
              )}
              {b.text}
            </pre>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inline(it) }} />
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inline(it) }} />
              ))}
            </ol>
          );
        }
        return (
          <p
            key={i}
            className="whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: inline(b.text) }}
          />
        );
      })}
    </div>
  );
}
