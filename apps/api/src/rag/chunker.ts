// Resume chunker: section-aware, parent-child, with context headers and overlapping windows.
//
// 1. Split the resume into sections at headings ("EXPERIENCE", "Skills:", ...).
// 2. Split each section into entries: a few header lines (e.g. company/title/dates) followed by
//    bullet points. Blank lines also separate entries.
// 3. Each entry becomes a PARENT chunk (not embedded; handed to the model as context).
// 4. Each bullet becomes a CHILD chunk (embedded; what search matches against). Its embedded text
//    gets a context header so "Led a team of 4" also carries "Experience > Brightline Health".
// 5. Entries without bullets (summary, skills, contact) are split into overlapping word windows
//    if they're long, so no child is too big to match precisely.

export interface DraftChunk {
  key: string;
  parentKey: string | null;
  kind: "parent" | "child";
  section: string;
  index: number;
  /** Text that gets embedded (children) or given to the model as context (parents). */
  content: string;
  /** Exact resume text covered, for citations. */
  sourceText: string;
  charStart: number;
  charEnd: number;
}

export const CHUNKING = {
  maxChildChars: 500,
  overlapChars: 100,
};

const KNOWN_HEADINGS = new Set([
  "summary", "professional summary", "profile", "about", "about me", "objective",
  "experience", "work experience", "professional experience", "employment", "employment history", "work history",
  "skills", "technical skills", "core skills", "core competencies", "key skills", "expertise",
  "education", "projects", "key projects", "certifications", "certificates", "awards", "achievements",
  "accomplishments", "publications", "languages", "interests", "volunteering", "contact",
]);

const BULLET_RE = /^\s*(?:[-*•·▪‣◦–]|\d+[.)])\s+/;

interface Line {
  text: string;
  start: number;
  end: number;
}

interface Entry {
  headerLines: Line[];
  bullets: Line[][]; // each bullet = its first line + wrapped continuation lines
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const raw of text.split("\n")) {
    lines.push({ text: raw, start, end: start + raw.length });
    start += raw.length + 1;
  }
  return lines;
}

function headingKey(text: string): string {
  return text.trim().replace(/[:\s]+$/, "").replace(/\s+/g, " ").toLowerCase();
}

function isHeading(line: Line, isFirstContentLine: boolean): boolean {
  const t = line.text.trim();
  if (!t || t.length > 40 || BULLET_RE.test(line.text)) return false;
  if (KNOWN_HEADINGS.has(headingKey(t))) return true;
  // Unknown ALL-CAPS short lines are headings too, except the very first line (usually the name).
  if (isFirstContentLine) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && t === t.toUpperCase() && t.split(/\s+/).length <= 4 && !/[@\d|]/.test(t);
}

function titleCase(text: string): string {
  return headingKey(text).replace(/\b\w/g, (c) => c.toUpperCase());
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Character span of some lines, ignoring leading indentation. */
function spanOf(lines: Line[]): { start: number; end: number } {
  const first = lines[0]!;
  return { start: first.start + (first.text.length - first.text.trimStart().length), end: lines[lines.length - 1]!.end };
}

function toEntries(lines: Line[]): Entry[] {
  const entries: Entry[] = [];
  let current: Entry | null = null;
  const close = () => {
    if (current && (current.headerLines.length || current.bullets.length)) entries.push(current);
    current = null;
  };

  for (const line of lines) {
    if (!line.text.trim()) {
      close();
    } else if (BULLET_RE.test(line.text)) {
      current ??= { headerLines: [], bullets: [] };
      current.bullets.push([line]);
    } else if (/^\s+\S/.test(line.text) && current?.bullets.length) {
      current.bullets[current.bullets.length - 1]!.push(line); // wrapped bullet text
    } else {
      if (current?.bullets.length) close(); // a plain line after bullets starts the next entry
      current ??= { headerLines: [], bullets: [] };
      current.headerLines.push(line);
    }
  }
  close();
  return entries;
}

/** Fixed-size word windows with overlap, so a fact at a window edge appears whole in one of them. */
function windows(text: string, offset: number): { start: number; end: number }[] {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ start: offset + m.index!, end: offset + m.index! + m[0].length }));
  const result: { start: number; end: number }[] = [];
  let i = 0;
  while (i < words.length) {
    let j = i;
    while (j + 1 < words.length && words[j + 1]!.end - words[i]!.start <= CHUNKING.maxChildChars) j++;
    result.push({ start: words[i]!.start, end: words[j]!.end });
    if (j === words.length - 1) break;
    // Step back so the next window starts ~overlapChars before this one ended.
    let next = j + 1;
    while (next - 1 > i && words[j]!.end - words[next - 1]!.start <= CHUNKING.overlapChars) next--;
    i = next;
  }
  return result;
}

export function chunkResume(text: string): DraftChunk[] {
  const lines = splitLines(text);

  // 1. Sections
  const sections: { title: string; lines: Line[] }[] = [{ title: "Contact", lines: [] }];
  let seenContent = false;
  for (const line of lines) {
    if (isHeading(line, !seenContent)) {
      sections.push({ title: titleCase(line.text), lines: [] });
    } else {
      sections[sections.length - 1]!.lines.push(line);
    }
    if (line.text.trim()) seenContent = true;
  }

  const chunks: DraftChunk[] = [];
  const add = (c: Omit<DraftChunk, "key" | "index">) => {
    const chunk = { ...c, key: `c${chunks.length}`, index: chunks.length };
    chunks.push(chunk);
    return chunk;
  };

  for (const section of sections) {
    for (const entry of toEntries(section.lines)) {
      // 2-3. Parent = the whole entry
      const all = [...entry.headerLines, ...entry.bullets.flat()].sort((a, b) => a.start - b.start);
      const p = spanOf(all);
      const parentSource = text.slice(p.start, p.end);
      const parent = add({
        parentKey: null, kind: "parent", section: section.title,
        content: `${section.title}\n${parentSource}`, sourceText: parentSource, charStart: p.start, charEnd: p.end,
      });

      const header = entry.headerLines.length ? collapse(text.slice(spanOf(entry.headerLines).start, spanOf(entry.headerLines).end)) : "";
      const context = header ? `${section.title} > ${header}` : section.title;

      if (entry.bullets.length) {
        // 4. One child per bullet, with a context header
        for (const bullet of entry.bullets) {
          const b = spanOf(bullet);
          const source = text.slice(b.start, b.end);
          add({
            parentKey: parent.key, kind: "child", section: section.title,
            content: `${context}: ${collapse(source.replace(BULLET_RE, ""))}`,
            sourceText: source, charStart: b.start, charEnd: b.end,
          });
        }
      } else {
        // 5. No bullets: overlapping windows over the entry text
        for (const w of windows(parentSource, p.start)) {
          const source = text.slice(w.start, w.end);
          add({
            parentKey: parent.key, kind: "child", section: section.title,
            content: `${section.title}: ${collapse(source)}`,
            sourceText: source, charStart: w.start, charEnd: w.end,
          });
        }
      }
    }
  }
  return chunks;
}
