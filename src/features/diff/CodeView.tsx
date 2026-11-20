import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

import { relativeTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import type { BlameCommit } from '@/lib/types';

/** Language support from the file extension. */
function languageFor(path: string): Extension | null {
  const name = path.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1);
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'json':
    case 'jsonc':
      return json();
    case 'md':
    case 'markdown':
      return markdown();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return html();
    case 'xml':
    case 'svg':
    case 'csproj':
    case 'xaml':
      return xml();
    case 'rs':
      return rust();
    case 'py':
      return python();
    case 'sql':
      return sql();
    case 'yml':
    case 'yaml':
      return yaml();
    case 'java':
    case 'kt':
      return java();
    case 'c':
    case 'h':
    case 'cpp':
    case 'cc':
    case 'hpp':
    case 'cs':
      return cpp();
    case 'go':
      return go();
    case 'php':
      return php();
    default:
      return null;
  }
}

const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword],
    color: 'var(--syntax-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syntax-number)' },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: 'var(--syntax-type)',
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--syntax-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--syntax-function)',
  },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--syntax-function)' },
  { tag: tags.heading, fontWeight: 'bold', color: 'var(--syntax-keyword)' },
  { tag: tags.link, textDecoration: 'underline' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '12.5px',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-line-add': { backgroundColor: 'var(--diff-add)' },
  '.cm-line-mod': { backgroundColor: 'color-mix(in oklch, var(--warning) 14%, transparent)' },
  '.cm-blame': { width: '300px', fontFamily: 'var(--font-sans)', fontSize: '11.5px' },
  '.cm-blame .cm-gutterElement': { padding: '0 8px', overflow: 'hidden', whiteSpace: 'nowrap' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--warning) 35%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--foreground)' },
  '.cm-panels input, .cm-panels button': { color: 'var(--foreground)' },
});

class BlameMarker extends GutterMarker {
  constructor(
    readonly text: string,
    readonly title: string,
    readonly hue: number,
    readonly first: boolean,
  ) {
    super();
  }
  eq(o: BlameMarker) {
    return o.text === this.text && o.first === this.first && o.hue === this.hue;
  }
  toDOM() {
    const el = document.createElement('div');
    el.textContent = this.first ? this.text : '';
    el.title = this.title;
    el.style.borderLeft = `3px solid oklch(0.65 0.12 ${this.hue})`;
    el.style.paddingLeft = '6px';
    el.style.cursor = 'pointer';
    return el;
  }
}

export interface BlameInfo {
  lines: string[];
  commits: Map<string, BlameCommit>;
  onPick: (hash: string) => void;
}

export interface CodeViewProps {
  value: string;
  path: string;
  editable?: boolean;
  wrap?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  /** 1-based line numbers to tint as added / modified. */
  lineMarks?: Map<number, 'add' | 'mod'>;
  blame?: BlameInfo | null;
}

/** CodeMirror view/editor. Re-created when `path`, `editable`, `wrap` or blame change. */
export function CodeView(props: CodeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const { path, editable, wrap, blame, lineMarks } = props;

  useEffect(() => {
    if (!host.current) return;
    const exts: Extension[] = [
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true }),
      syntaxHighlighting(highlight),
      theme,
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            latest.current.onSave?.();
            return true;
          },
        },
        ...searchKeymap,
      ]),
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(!!editable),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) latest.current.onChange?.(u.state.doc.toString());
      }),
    ];
    if (editable)
      exts.push(
        history(),
        indentOnInput(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      );
    if (wrap) exts.push(EditorView.lineWrapping);
    const lang = languageFor(path);
    if (lang) exts.push(lang);
    if (lineMarks && lineMarks.size > 0) {
      exts.push(
        EditorView.decorations.of((v) => {
          const b = new RangeSetBuilder<Decoration>();
          const doc = v.state.doc;
          for (let n = 1; n <= doc.lines; n++) {
            const m = lineMarks.get(n);
            if (m)
              b.add(doc.line(n).from, doc.line(n).from, Decoration.line({ class: `cm-line-${m}` }));
          }
          return b.finish();
        }),
      );
    }
    if (blame) {
      exts.unshift(
        gutter({
          class: 'cm-blame',
          lineMarker(v, line) {
            const n = v.state.doc.lineAt(line.from).number;
            const hash = blame.lines[n - 1];
            if (!hash) return null;
            const c = blame.commits.get(hash);
            const uncommitted = /^0+$/.test(hash);
            const text = uncommitted
              ? t('Not committed yet')
              : `${c?.author ?? ''} · ${c ? relativeTime(c.time) : ''} · ${c?.summary ?? ''}`;
            let h = 0;
            for (const ch of hash.slice(0, 8)) h = (h * 31 + ch.charCodeAt(0)) % 360;
            return new BlameMarker(
              text,
              uncommitted ? text : `${hash.slice(0, 7)}  ${text}`,
              h,
              blame.lines[n - 2] !== hash,
            );
          },
          domEventHandlers: {
            mousedown(v, line) {
              const n = v.state.doc.lineAt(line.from).number;
              const hash = blame.lines[n - 1];
              if (hash && !/^0+$/.test(hash)) blame.onPick(hash);
              return true;
            },
          },
        }),
      );
    }
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: latest.current.value, extensions: exts }),
    });
    view.current = v;
    if (editable) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
  }, [path, editable, wrap, blame, lineMarks]);

  // Follow external value changes (read-only views, or a reload while editing).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== props.value)
      v.dispatch({ changes: { from: 0, to: cur.length, insert: props.value } });
  }, [props.value]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
