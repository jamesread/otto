/**
 * Parse and format todo.txt lines per todotxt.org specification.
 * Format: [x ] [YYYY-MM-DD ] [(A)- (Z)] [YYYY-MM-DD ] body +project @context key:value
 */

export type ParsedTask = {
  /** Stable id: from "id:uuid" in line, or generated from line index for round-trip */
  id: string;
  /** Whether task is completed (line starts with x ) */
  completed: boolean;
  /** Completion date if completed */
  completionDate: string | null;
  /** Priority (A)-(Z) or null */
  priority: string | null;
  /** Creation date YYYY-MM-DD or null */
  created: string | null;
  /** Raw body (description + metadata tokens) */
  body: string;
  /** Human-readable description (body with metadata tokens stripped for display) */
  description: string;
  /** Project names from +ProjectName */
  projects: string[];
  /** Contexts from @context */
  contexts: string[];
  /** Key-value pairs (due:YYYY-MM-DD, id:uuid, etc.) */
  keyValues: Record<string, string>;
  /** Original line for round-trip when no id: present */
  rawLine: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_RE = /^\([A-Z]\)$/;
const KEY_VALUE_RE = /^([a-zA-Z0-9_-]+):(.+)$/;

function isDate(s: string): boolean {
  return DATE_RE.test(s);
}

function isPriority(s: string): boolean {
  return PRIORITY_RE.test(s);
}

/** Generate a stable id for a line that has no id: key (hash-based). */
function lineId(line: string, index: number): string {
  let h = 0;
  for (let i = 0; i < line.length; i++) {
    h = (h * 31 + line.charCodeAt(i)) >>> 0;
  }
  return `line-${index}-${h.toString(36)}`;
}

/**
 * Parse a single todo.txt line into structured fields.
 * See https://github.com/todotxt/todo.txt and todotxt.org.
 */
export function parseLine(line: string, lineIndex: number): ParsedTask {
  const rawLine = line;
  const trimmed = line.trim();
  let completed = false;
  let completionDate: string | null = null;
  let priority: string | null = null;
  let created: string | null = null;
  let rest = trimmed;

  // Completed: "x " or "x YYYY-MM-DD "
  if (rest.startsWith('x ')) {
    completed = true;
    rest = rest.slice(2).trimStart();
    const next = rest.slice(0, 10);
    if (isDate(next)) {
      completionDate = next;
      rest = rest.slice(10).trimStart();
    }
  }

  // Priority: (A) to (Z)
  if (rest.startsWith('(') && rest.length >= 4 && rest[3] === ')') {
    const p = rest.slice(0, 4);
    if (isPriority(p)) {
      priority = p;
      rest = rest.slice(4).trimStart();
    }
  }

  // Creation date: YYYY-MM-DD
  if (rest.length >= 10 && isDate(rest.slice(0, 10))) {
    created = rest.slice(0, 10);
    rest = rest.slice(10).trimStart();
  }

  // Rest is body: tokens can be +project, @context, key:value, or plain text
  const projects: string[] = [];
  const contexts: string[] = [];
  const keyValues: Record<string, string> = {};
  const descriptionParts: string[] = [];
  const tokens = rest.split(/\s+/);

  for (const token of tokens) {
    if (token.startsWith('+') && token.length > 1) {
      projects.push(token.slice(1));
    } else if (token.startsWith('@') && token.length > 1) {
      contexts.push(token.slice(1));
    } else if (KEY_VALUE_RE.test(token)) {
      const match = token.match(KEY_VALUE_RE)!;
      keyValues[match[1]] = match[2];
    } else {
      descriptionParts.push(token);
    }
  }

  const description = descriptionParts.join(' ').trim();
  const id = keyValues.id ?? lineId(rawLine, lineIndex);

  return {
    id,
    completed,
    completionDate,
    priority,
    created,
    body: rest,
    description,
    projects,
    contexts,
    keyValues,
    rawLine,
  };
}

/**
 * Parse a full todo.txt file (one task per line; blank lines ignored).
 */
export function parseFile(content: string): ParsedTask[] {
  const lines = content.split(/\n/);
  const tasks: ParsedTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line === '') continue;
    tasks.push(parseLine(line, i));
  }
  return tasks;
}

/**
 * Format a ParsedTask back to a todo.txt line.
 * Preserves id in keyValues so we can find the line on edit/delete.
 */
export function formatTask(task: ParsedTask): string {
  const parts: string[] = [];

  if (task.completed) {
    parts.push('x');
    if (task.completionDate) {
      parts.push(task.completionDate);
    }
  }

  if (task.priority) {
    parts.push(task.priority);
  }

  if (task.created) {
    parts.push(task.created);
  }

  // Description (omit if empty so we don't get extra spaces)
  if (task.description) {
    parts.push(task.description);
  }

  // Projects
  for (const p of task.projects) {
    parts.push('+' + p);
  }

  // Contexts
  for (const c of task.contexts) {
    parts.push('@' + c);
  }

  // Key-values (include id so we can round-trip)
  const keys = Object.keys(task.keyValues).sort();
  for (const k of keys) {
    parts.push(k + ':' + task.keyValues[k]);
  }

  return parts.join(' ');
}

/**
 * Build Item additionalFields from a ParsedTask (for listItems response).
 */
export function additionalFieldsFromParsedTask(task: ParsedTask): { [key: string]: string } {
  const fields: { [key: string]: string } = {
    name: task.description || 'Untitled task',
    project: task.projects[0] ?? '',
    tags: [
      ...task.contexts.map((c) => (c.includes(':') ? c : `@${c}`)),
      ...Object.entries(task.keyValues)
        .filter(([k]) => k !== 'id')
        .map(([k, v]) => `${k}:${v}`),
    ].join('\n'),
  };
  if (task.keyValues.due) fields.due = task.keyValues.due;
  if (task.created) fields.created = task.created;
  return fields;
}

/**
 * Build a ParsedTask from Item additionalFields (for create/edit from app).
 */
export function parsedTaskFromItem(
  id: string,
  additionalFields: { [key: string]: string },
): ParsedTask {
  const name = additionalFields.name ?? additionalFields.Name ?? '';
  const project = additionalFields.project?.trim() ?? '';
  const tagsRaw = additionalFields.tags ?? '';
  const due = additionalFields.due ?? '';
  const projects = project ? [project] : [];
  const contexts: string[] = [];
  const keyValues: Record<string, string> = { id };
  if (due) keyValues.due = due;

  // Parse tags (key:value per line) into contexts and keyValues
  const tagLines = tagsRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of tagLines) {
    const colon = line.indexOf(':');
    if (colon >= 0) {
      keyValues[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    } else if (line.startsWith('@')) {
      contexts.push(line.slice(1));
    } else if (line) {
      contexts.push(line);
    }
  }

  const created = additionalFields.created ?? null;

  return {
    id,
    completed: false,
    completionDate: null,
    priority: null,
    created,
    body: name,
    description: name,
    projects,
    contexts,
    keyValues,
    rawLine: '',
  };
}
