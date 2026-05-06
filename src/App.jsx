import { useState, useRef, useEffect, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = typeof window.__TAURI_INTERNALS__ !== "undefined" ? getCurrentWindow() : null;

function highlightJson(str) {
  const esc = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")\s*:|("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")|\b(true|false)\b|\b(null)\b|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g,
    (_, key, str, bool, nil, num, punct) => {
      if (key  !== undefined) return `<span style="color:var(--c-key)">${key}</span>:`;
      if (str  !== undefined) return `<span style="color:var(--c-str)">${str}</span>`;
      if (bool !== undefined) return `<span style="color:var(--c-bool)">${bool}</span>`;
      if (nil  !== undefined) return `<span style="color:var(--c-nil)">${nil}</span>`;
      if (num  !== undefined) return `<span style="color:var(--c-num)">${num}</span>`;
      if (punct!== undefined) return `<span style="color:var(--c-punct)">${punct}</span>`;
      return _;
    }
  );
}

// Insert PUA marker chars around each match (process back-to-front to preserve positions)
//  = current match open,  = current match close
//  = other match open,    = other match close
function insertMatchMarkers(str, matches, currentIdx) {
  if (!matches.length) return str;
  const sorted = matches.map((m, i) => ({ ...m, i })).sort((a, b) => b.start - a.start);
  let result = str;
  for (const m of sorted) {
    const cur = m.i === currentIdx;
    result =
      result.slice(0, m.start) +
      (cur ? "" : "") +
      result.slice(m.start, m.end) +
      (cur ? "" : "") +
      result.slice(m.end);
  }
  return result;
}

const C = {
  bg:      "var(--c-bg)",
  surface: "var(--c-surface)",
  border:  "var(--c-border)",
  text:    "var(--c-text)",
  muted:   "var(--c-muted)",
  key:     "var(--c-key)",
  str:     "var(--c-str)",
  num:     "var(--c-num)",
  bool:    "var(--c-bool)",
  nil:     "var(--c-nil)",
  ok:      "var(--c-ok)",
  err:     "var(--c-err)",
};

const S = {
  btn:   { background:"var(--c-btn-bg)",    border:"0.5px solid var(--c-btn-border)",  color:"var(--c-btn-text)", padding:"4px 12px", borderRadius:3, cursor:"pointer", fontSize:12, fontFamily:"monospace" },
  small: { background:"var(--c-btn-sm-bg)", border:"0.5px solid var(--c-btn-border)",  color:"var(--c-muted)",    padding:"1px 6px",  borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:"monospace" },
  del:   { background:"var(--c-btn-sm-bg)", border:"0.5px solid var(--c-del-border)",  color:"var(--c-del-text)", padding:"1px 6px",  borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:"monospace" },
};

function cloneSet(root, path, val) {
  const c = JSON.parse(JSON.stringify(root));
  if (!path.length) return val;
  let n = c;
  for (let i = 0; i < path.length - 1; i++) n = n[path[i]];
  n[path[path.length - 1]] = val;
  return c;
}

function cloneDel(root, path) {
  const c = JSON.parse(JSON.stringify(root));
  let n = c;
  for (let i = 0; i < path.length - 1; i++) n = n[path[i]];
  const k = path[path.length - 1];
  Array.isArray(n) ? n.splice(k, 1) : delete n[k];
  return c;
}

function cloneRenameKey(root, path, newKey) {
  const c = JSON.parse(JSON.stringify(root));
  const parentPath = path.slice(0, -1);
  let parent = c;
  for (const k of parentPath) parent = parent[k];
  const oldKey = path[path.length - 1];
  const entries = Object.entries(parent).map(([k, v]) => k === String(oldKey) ? [newKey, v] : [k, v]);
  for (const k of Object.keys(parent)) delete parent[k];
  for (const [k, v] of entries) parent[k] = v;
  return c;
}

function cloneDup(root, path) {
  const c = JSON.parse(JSON.stringify(root));
  const parentPath = path.slice(0, -1);
  let parent = c;
  for (const k of parentPath) parent = parent[k];
  const key = path[path.length - 1];
  if (Array.isArray(parent)) {
    parent.splice(Number(key) + 1, 0, JSON.parse(JSON.stringify(parent[key])));
  } else {
    const oldKey = String(key);
    let newKey = oldKey + "_copy", i = 2;
    while (newKey in parent) newKey = oldKey + "_copy" + (i++);
    const entries = [];
    for (const [k, v] of Object.entries(parent)) {
      entries.push([k, v]);
      if (k === oldKey) entries.push([newKey, JSON.parse(JSON.stringify(v))]);
    }
    for (const k of Object.keys(parent)) delete parent[k];
    for (const [k, v] of entries) parent[k] = v;
  }
  return c;
}

function lineCount(val) {
  if (val === null || typeof val !== "object") return 1;
  const vals = Array.isArray(val) ? val : Object.values(val);
  if (vals.length === 0) return 1;
  return 2 + vals.reduce((s, v) => s + lineCount(v), 0);
}

function findStartLine(parsed, path) {
  try {
    let line = 1;
    let cur = parsed;
    for (const key of path) {
      if (cur === null || typeof cur !== "object") return null;
      line += 1;
      const entries = Array.isArray(cur) ? cur.map((v, i) => [i, v]) : Object.entries(cur);
      for (const [k, v] of entries) {
        if (String(k) === String(key)) break;
        line += lineCount(v);
      }
      cur = cur[key];
    }
    return line;
  } catch (_) {
    return null;
  }
}

function collectFoldPaths(val, path = []) {
  if (val === null || typeof val !== "object") return [];
  const entries = Array.isArray(val) ? val.map((v, i) => [i, v]) : Object.entries(val);
  if (entries.length === 0) return [];
  const paths = [JSON.stringify(path)];
  for (const [k, v] of entries) paths.push(...collectFoldPaths(v, [...path, k]));
  return paths;
}

function cloneAdd(root, path) {
  const c = JSON.parse(JSON.stringify(root));
  let target = c;
  for (const k of path) target = target[k];
  if (Array.isArray(target)) {
    target.push(null);
  } else {
    let k = "key", i = 1;
    while (k in target) k = "key" + (++i);
    target[k] = null;
  }
  return c;
}

function FoldableRaw({ parsed, folded, onToggle, selectedPk, selectSeq }) {
  const selectedRowRef = useRef(null);

  useEffect(() => {
    if (selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedPk]);

  function Prim({ v }) {
    if (v === null) return <span style={{color:"var(--c-nil)"}}>null</span>;
    if (typeof v === "boolean") return <span style={{color:"var(--c-bool)"}}>{String(v)}</span>;
    if (typeof v === "number") return <span style={{color:"var(--c-num)"}}>{v}</span>;
    return <span style={{color:"var(--c-str)"}}>{JSON.stringify(v)}</span>;
  }

  const rows = [];

  function walk(val, path, indent, keyNode, isLast) {
    const pk = JSON.stringify(path);
    const isObj = val !== null && typeof val === "object";
    const isArr = isObj && Array.isArray(val);

    if (!isObj) {
      rows.push({ indent, keyNode, valueNode: <Prim v={val} />, comma: !isLast, pk: null, rowPk: pk });
      return;
    }

    const entries = isArr ? val.map((v, i) => [i, v]) : Object.entries(val);
    const ob = isArr ? "[" : "{";
    const cb = isArr ? "]" : "}";

    if (entries.length === 0) {
      rows.push({ indent, keyNode, valueNode: <span style={{color:"var(--c-punct)"}}>{ob}{cb}</span>, comma: !isLast, pk: null, rowPk: pk });
      return;
    }

    const isFolded = folded.has(pk);

    if (isFolded) {
      rows.push({
        indent, keyNode,
        valueNode: (
          <>
            <span style={{color:"var(--c-punct)"}}>{ob}</span>
            <span style={{color:"var(--c-punct)", cursor:"pointer"}} onClick={e => { e.stopPropagation(); onToggle(pk); }}>…</span>
            <span style={{color:"var(--c-punct)"}}>{cb}</span>
          </>
        ),
        comma: !isLast, pk, isFolded: true, rowPk: pk
      });
      return;
    }

    rows.push({ indent, keyNode, valueNode: <span style={{color:"var(--c-punct)"}}>{ob}</span>, comma: false, pk, isFolded: false, rowPk: pk });

    entries.forEach(([k, v], i) => {
      const kn = isArr ? null : (
        <><span style={{color:"var(--c-key)"}}>"{String(k)}"</span><span style={{color:"var(--c-punct)"}}>: </span></>
      );
      walk(v, [...path, k], indent + 1, kn, i === entries.length - 1);
    });

    rows.push({ indent, keyNode: null, valueNode: <span style={{color:"var(--c-punct)"}}>{cb}</span>, comma: !isLast, pk: null, rowPk: null });
  }

  if (parsed !== null) walk(parsed, [], 0, null, true);

  return (
    <div style={{ margin:0, padding:12, fontFamily:"monospace", fontSize:13, lineHeight:1.6, background:"var(--c-bg)", color:"var(--c-text)", overflow:"auto", height:"100%", boxSizing:"border-box" }}>
      {rows.map((row, i) => {
        const isSelected = row.rowPk !== null && row.rowPk === selectedPk;
        return (
          <div
            key={i}
            ref={isSelected ? selectedRowRef : null}
            style={{ position:"relative", display:"flex", alignItems:"center", minHeight:"1.6em", borderRadius:2, background: isSelected ? "var(--c-sel-bg)" : "transparent" }}
          >
            {isSelected && <div key={selectSeq} className="hl-flash" />}
            <span style={{ whiteSpace:"pre", flexShrink:0 }}>{" ".repeat(row.indent * 2)}</span>
            <span
              style={{ width:12, flexShrink:0, textAlign:"center", fontSize:9, color:"var(--c-muted)", cursor: row.pk !== null ? "pointer" : "default", userSelect:"none" }}
              onClick={row.pk !== null ? e => { e.stopPropagation(); onToggle(row.pk); } : undefined}
            >
              {row.pk !== null ? (row.isFolded ? "▸" : "▾") : ""}
            </span>
            {row.keyNode}
            {row.valueNode}
            {row.comma && <span style={{color:"var(--c-punct)"}}>,</span>}
          </div>
        );
      })}
    </div>
  );
}

function Node({ val, path, root, onUpdate, treeForce, onSelect, selectedPk, selectSeq }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (treeForce) setOpen(treeForce.open);
  }, [treeForce]);

  const isSelected = selectedPk !== null && selectedPk === JSON.stringify(path);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  const isObj = val !== null && typeof val === "object";
  const isArr = isObj && Array.isArray(val);
  const key = path.length ? path[path.length - 1] : null;
  const isObjKey = key !== null && typeof key === "string";

  const commit = (v) => {
    let nv; try { nv = JSON.parse(v); } catch (_) { nv = v; }
    onUpdate(cloneSet(root, path, nv));
    setEditing(false);
  };

  const commitKey = (v) => {
    const trimmed = v.trim();
    if (trimmed && trimmed !== key) onUpdate(cloneRenameKey(root, path, trimmed));
    setEditingKey(false);
  };

  const keyEl = key !== null && (
    <>
      {isObjKey && editingKey ? (
        <input
          autoFocus
          value={keyDraft}
          onChange={e => setKeyDraft(e.target.value)}
          onBlur={e => commitKey(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") commitKey(keyDraft); if (e.key === "Escape") setEditingKey(false); }}
          style={{ background:"var(--c-btn-sm-bg)", border:"0.5px solid var(--c-key)", color:"var(--c-key)", padding:"1px 5px", borderRadius:3, fontFamily:"monospace", fontSize:12, outline:"none", minWidth:60 }}
        />
      ) : (
        <span
          style={{ color: C.key, cursor: isObjKey ? "pointer" : "default" }}
          title={isObjKey ? "double-click to rename key" : undefined}
          onDoubleClick={() => { if (isObjKey) { setKeyDraft(key); setEditingKey(true); } }}
        >
          {typeof key === "number" ? key : `"${key}"`}
        </span>
      )}
      <span style={{ color: "var(--c-dim)", margin: "0 2px" }}>:</span>
    </>
  );

  let valEl;
  if (isObj) {
    valEl = <span style={{ color: "var(--c-muted)", fontSize: 11 }}>{isArr ? `[ ${val.length} ]` : `{ ${Object.keys(val).length} }`}</span>;
  } else if (editing) {
    valEl = (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(draft); if (e.key === "Escape") setEditing(false); }}
        style={{ background:"var(--c-btn-sm-bg)", border:"0.5px solid var(--c-muted)", color:"var(--c-text)", padding:"1px 5px", borderRadius:3, fontFamily:"monospace", fontSize:12, outline:"none", minWidth:60 }}
      />
    );
  } else {
    const color = val === null ? C.nil : typeof val === "boolean" ? C.bool : typeof val === "number" ? C.num : C.str;
    const txt = val === null ? "null" : typeof val === "string" ? `"${val}"` : String(val);
    valEl = (
      <span style={{ color, cursor:"pointer" }} title="double-click to edit"
        onDoubleClick={() => { setDraft(val === null ? "null" : typeof val === "string" ? val : String(val)); setEditing(true); }}>
        {txt}
      </span>
    );
  }

  const acts = hovered && !editing && !editingKey && (
    <span style={{ display:"flex", gap:3, marginLeft:6 }}>
      {isObj  && <button style={S.small} onClick={e => { e.stopPropagation(); onUpdate(cloneAdd(root, path)); }}>+ add</button>}
      {!isObj && <button style={S.small} onClick={e => { e.stopPropagation(); onUpdate(cloneSet(root, path, {})); }}>toObj</button>}
      {!isObj && <button style={S.small} onClick={e => { e.stopPropagation(); onUpdate(cloneSet(root, path, [])); }}>toArr</button>}
      {path.length > 0 && <button style={S.small} onClick={e => { e.stopPropagation(); onUpdate(cloneDup(root, path)); }}>dup</button>}
      {path.length > 0 && <button style={S.del} onClick={e => { e.stopPropagation(); onUpdate(cloneDel(root, path)); }}>✕</button>}
    </span>
  );

  return (
    <div style={{ margin:"1px 0" }}>
      <div
        style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 4px", borderRadius:3, minHeight:22, background: isSelected ? "var(--c-sel-bg)" : hovered ? "var(--c-hover)" : "transparent" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect?.(path)}
      >
        <span
          style={{ width:14, fontSize:10, color:"var(--c-muted)", cursor: isObj ? "pointer" : "default", userSelect:"none", textAlign:"center", flexShrink:0 }}
          onClick={e => { e.stopPropagation(); isObj && setOpen(o => !o); }}
        >
          {isObj ? (open ? "▾" : "▸") : "·"}
        </span>
        {keyEl}
        {valEl}
        {acts}
      </div>
      {isObj && open && (
        <div style={{ paddingLeft:18, borderLeft:"0.5px solid var(--c-indent-line)", marginLeft:7 }}>
          {(isArr ? val.map((v,i) => [i,v]) : Object.entries(val)).map(([k,v]) => (
            <Node key={String(k)} val={v} path={[...path, k]} root={root} onUpdate={onUpdate} treeForce={treeForce} onSelect={onSelect} selectedPk={selectedPk} selectSeq={selectSeq} />
          ))}
        </div>
      )}
    </div>
  );
}

const INIT = "{}";

export default function App() {
  const [raw, setRaw] = useState(INIT);
  const [parsed, setParsed] = useState({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [rawMode, setRawMode] = useState("edit");
  const [rawFolded, setRawFolded] = useState(new Set());
  const [treeForce, setTreeForce] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectSeq, setSelectSeq] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [currentFileName, setCurrentFileName] = useState(null);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Find / replace state
  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findMatchIdx, setFindMatchIdx] = useState(0);
  const [findCase, setFindCase] = useState(false);

  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const rawRef    = useRef(INIT);
  const taRef     = useRef(null);
  const hlRef     = useRef(null);
  const findInputRef    = useRef(null);
  const splitContainerRef = useRef(null);
  const [splitPos, setSplitPos] = useState(50); // percent

  // ── Find matches ──────────────────────────────────────────────────────────
  const findMatches = useMemo(() => {
    if (!findQuery || rawMode !== "edit") return [];
    const haystack = findCase ? rawRef.current : rawRef.current.toLowerCase();
    const needle   = findCase ? findQuery       : findQuery.toLowerCase();
    const results  = [];
    let pos = 0;
    while (pos < haystack.length) {
      const idx = haystack.indexOf(needle, pos);
      if (idx === -1) break;
      results.push({ start: idx, end: idx + needle.length });
      pos = idx + 1;
    }
    return results;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, findQuery, findCase, rawMode]);

  // Reset to first match when query / case changes
  useEffect(() => { setFindMatchIdx(0); }, [findQuery, findCase]);

  // Clamp idx when match count shrinks
  useEffect(() => {
    if (findMatches.length > 0 && findMatchIdx >= findMatches.length) {
      setFindMatchIdx(findMatches.length - 1);
    }
  }, [findMatches.length, findMatchIdx]);

  // ── Pre overlay HTML (with find highlights) ───────────────────────────────
  const preHtml = useMemo(() => {
    if (!findOpen || !findMatches.length) return highlightJson(raw) + "\n";
    const marked = insertMatchMarkers(raw, findMatches, findMatchIdx);
    return highlightJson(marked)
      .replace(//g, '<mark style="background:rgba(255,180,50,0.55);color:inherit;border-radius:2px;outline:1px solid rgba(255,200,80,0.85)">')
      .replace(//g, "</mark>")
      .replace(//g, '<mark style="background:rgba(255,180,50,0.2);color:inherit;border-radius:2px">')
      .replace(//g, "</mark>") + "\n";
  }, [raw, findOpen, findMatches, findMatchIdx]);

  // ── Scroll textarea + pre to a match ─────────────────────────────────────
  const scrollToMatch = (idx, matches) => {
    const list = matches ?? findMatches;
    if (!list.length || !taRef.current) return;
    const m = list[Math.min(idx, list.length - 1)];
    if (!m) return;
    const before = rawRef.current.slice(0, m.start);
    const line   = before.split("\n").length;
    const lineH  = 13 * 1.6;
    const lineTop = (line - 1) * lineH;
    const containerH = taRef.current.clientHeight;
    const top = Math.max(0, lineTop - containerH / 2 + lineH / 2);
    taRef.current.scrollTop = top;
    if (hlRef.current) hlRef.current.scrollTop = top;
    // Highlight selection in textarea
    taRef.current.focus();
    taRef.current.setSelectionRange(m.start, m.end);
  };

  // Auto-scroll when query changes and we have matches
  useEffect(() => {
    if (findOpen && findMatches.length > 0) scrollToMatch(0, findMatches);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, findCase]);

  // ── Navigate matches ──────────────────────────────────────────────────────
  const findNextMatch = () => {
    if (!findMatches.length) return;
    const idx = (findMatchIdx + 1) % findMatches.length;
    setFindMatchIdx(idx);
    scrollToMatch(idx, findMatches);
  };

  const findPrevMatch = () => {
    if (!findMatches.length) return;
    const idx = (findMatchIdx - 1 + findMatches.length) % findMatches.length;
    setFindMatchIdx(idx);
    scrollToMatch(idx, findMatches);
  };

  // ── Replace ───────────────────────────────────────────────────────────────
  const replaceOne = () => {
    if (!findMatches.length) return;
    const m = findMatches[Math.min(findMatchIdx, findMatches.length - 1)];
    pushHistory();
    const next = rawRef.current.slice(0, m.start) + replaceText + rawRef.current.slice(m.end);
    rawRef.current = next;
    setRaw(next);
    tryParse(next);
    setStatus("replaced");
  };

  const replaceAll = () => {
    if (!findMatches.length) return;
    pushHistory();
    let next = rawRef.current;
    for (let i = findMatches.length - 1; i >= 0; i--) {
      const m = findMatches[i];
      next = next.slice(0, m.start) + replaceText + next.slice(m.end);
    }
    const count = findMatches.length;
    rawRef.current = next;
    setRaw(next);
    tryParse(next);
    setStatus(`replaced ${count}`);
  };

  // ── Open / close find bar helpers ─────────────────────────────────────────
  const openFind = (withReplace = false) => {
    if (rawMode !== "edit") return;
    setFindOpen(true);
    setShowReplace(withReplace);
    setTimeout(() => findInputRef.current?.focus(), 0);
  };

  const closeFind = () => {
    setFindOpen(false);
    taRef.current?.focus();
  };

  // ── Resizable divider ─────────────────────────────────────────────────────
  const onDividerMouseDown = (e) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    document.body.style.cursor    = "col-resize";
    document.body.style.userSelect = "none";
    const onMouseMove = (ev) => {
      const rect = container.getBoundingClientRect();
      const pct  = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100));
      setSplitPos(pct);
    };
    const onMouseUp = () => {
      document.body.style.cursor    = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
  };

  // ── Undo / redo ───────────────────────────────────────────────────────────
  const handleSelect = (path) => {
    setSelectedPath(path);
    setSelectSeq(s => s + 1);
  };

  const pushHistory = () => {
    undoStack.current = [...undoStack.current.slice(-99), rawRef.current];
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const undoFnRef = useRef(null);
  const redoFnRef = useRef(null);

  const undo = () => {
    if (!undoStack.current.length) return;
    const prev = undoStack.current.pop();
    redoStack.current.unshift(rawRef.current);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    rawRef.current = prev;
    setRaw(prev); tryParse(prev); setStatus("undo");
  };

  const redo = () => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.shift();
    undoStack.current.push(rawRef.current);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    rawRef.current = next;
    setRaw(next); tryParse(next); setStatus("redo");
  };

  undoFnRef.current = undo;
  redoFnRef.current = redo;

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      // Find shortcuts — handle before textarea guard
      if (mod && e.key === "f") { e.preventDefault(); openFind(false); return; }
      if (mod && e.key === "h") { e.preventDefault(); openFind(true);  return; }
      if (e.key === "Escape" && findOpen) { e.preventDefault(); closeFind(); return; }
      if (mod && e.key === "s") { e.preventDefault(); saveFile(); return; }
      if (mod && e.key === "o") { e.preventDefault(); openFile(); return; }
      // Skip undo/redo when typing in textarea
      if (document.activeElement === taRef.current) return;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); undoFnRef.current(); }
      if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redoFnRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, rawMode]);

  const selectedPk = selectedPath !== null ? JSON.stringify(selectedPath) : null;
  const highlightLine = selectedPath !== null && parsed !== null ? findStartLine(parsed, selectedPath) : null;

  useEffect(() => {
    if (highlightLine === null) return;
    const lineH = 13 * 1.6;
    const lineTop = (highlightLine - 1) * lineH;
    const containerH = taRef.current?.clientHeight ?? 400;
    const top = Math.max(0, lineTop - containerH / 2 + lineH / 2);
    if (taRef.current) taRef.current.scrollTop = top;
    if (hlRef.current) hlRef.current.scrollTop = top;
  }, [highlightLine]);

  const toggleRawFold = (pk) => setRawFolded(prev => {
    const n = new Set(prev);
    n.has(pk) ? n.delete(pk) : n.add(pk);
    return n;
  });

  const rawExpandAll   = () => setRawFolded(new Set());
  const rawCollapseAll = () => setRawFolded(new Set(collectFoldPaths(parsed)));
  const treeExpandAll   = () => setTreeForce(f => ({ seq: (f?.seq || 0) + 1, open: true }));
  const treeCollapseAll = () => setTreeForce(f => ({ seq: (f?.seq || 0) + 1, open: false }));

  const syncScroll = () => {
    if (hlRef.current && taRef.current) {
      hlRef.current.scrollTop  = taRef.current.scrollTop;
      hlRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const tryParse = (v) => {
    if (!v.trim()) { setParsed(null); setError(""); return false; }
    try { setParsed(JSON.parse(v)); setError(""); return true; }
    catch (e) { setParsed(null); setError(e.message); return false; }
  };

  const onInput = (v) => { rawRef.current = v; setRaw(v); setStatus(""); tryParse(v); };

  const onUpdate = (next) => {
    pushHistory();
    const s = JSON.stringify(next, null, 2);
    rawRef.current = s;
    setParsed(next); setRaw(s); setError(""); setStatus("saved");
  };

  const format = () => { try { const p=JSON.parse(raw); const s=JSON.stringify(p,null,2); pushHistory(); rawRef.current=s; setRaw(s); setParsed(p); setStatus("formatted"); setError(""); } catch(e){setError(e.message);} };
  const minify = () => { try { const p=JSON.parse(raw); const s=JSON.stringify(p);     pushHistory(); rawRef.current=s; setRaw(s); setParsed(p); setStatus("minified"); setError(""); } catch(e){setError(e.message);} };
  const clear  = () => { pushHistory(); rawRef.current=INIT; setRaw(INIT); setParsed({}); setError(""); setStatus(""); setCurrentFileName(null); };

  // ── File open / save ──────────────────────────────────────────────────────
  const openFile = () => {
    const input = document.createElement("input");
    input.type   = "file";
    input.accept = ".json,application/json,text/plain";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target.result;
        pushHistory();
        rawRef.current = content;
        setRaw(content);
        tryParse(content);
        setStatus("opened");
        setCurrentFileName(file.name);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const saveFile = () => {
    const blob = new Blob([raw], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = currentFileName || "data.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("saved");
  };

  // ── Shared input style for find/replace bars ──────────────────────────────
  const findInputStyle = {
    flex: 1,
    background: "var(--c-input-bg)",
    border: "0.5px solid var(--c-border-find)",
    color: "var(--c-text)",
    padding: "3px 8px",
    borderRadius: 3,
    fontFamily: "monospace",
    fontSize: 12,
    outline: "none",
  };

  return (
    <div style={{ background:"var(--c-bg)", color:"var(--c-text)", fontFamily:"monospace", fontSize:13, height:"100vh", display:"flex", flexDirection:"column" }}>
      {/* ── Title bar ──────────────────────────────────────────────────── */}
      <div
        data-tauri-drag-region
        style={{ display:"flex", alignItems:"center", gap:8, padding:"0 0 0 12px", background:"var(--c-surface)", borderBottom:"0.5px solid var(--c-border)", flexShrink:0, height:38, userSelect:"none" }}
      >
        <span data-tauri-drag-region style={{ fontSize:11, color:"var(--c-muted)", letterSpacing:"0.05em" }}>
          JsonEditor made with ❤️ by <a href="https://ajazsiddiqui.com" target="_blank" rel="noopener noreferrer" style={{ color:"var(--c-muted)", textDecoration:"none", borderBottom:"0.5px solid var(--c-muted)" }}>ajazsiddiqui</a>
        </span>
        {currentFileName && (
          <span data-tauri-drag-region style={{ fontSize:11, color:"var(--c-ok)", opacity:0.75, letterSpacing:"0.03em", maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            — {currentFileName}
          </span>
        )}
        <div data-tauri-drag-region style={{ flex:1 }} />
        <button style={S.btn} onClick={openFile} title="Ctrl+O">open</button>
        <button style={S.btn} onClick={saveFile} title="Ctrl+S">save</button>
        <button style={{ ...S.btn, opacity: canUndo ? 1 : 0.3 }} onClick={undo} disabled={!canUndo} title="Ctrl+Z">↩ undo</button>
        <button style={{ ...S.btn, opacity: canRedo ? 1 : 0.3 }} onClick={redo} disabled={!canRedo} title="Ctrl+Y">↪ redo</button>
        <button style={S.btn} onClick={format}>format</button>
        <button style={S.btn} onClick={minify}>minify</button>
        <button style={{ ...S.btn, borderColor:"var(--c-clear-border)", color:"var(--c-clear-text)" }} onClick={clear}>clear</button>
        <button
          onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
          title="toggle theme"
          style={{ background:"transparent", border:"none", cursor:"pointer", fontSize:16, padding:"0 4px", lineHeight:1, display:"flex", alignItems:"center" }}
        >{theme === "dark" ? "☀️" : "🌙"}</button>
        {status && !error && (
          <span style={{ fontSize:11, padding:"3px 8px", borderRadius:3, background:"var(--c-ok-bg)", color:"var(--c-ok)", border:"0.5px solid var(--c-ok-border)" }}>{status}</span>
        )}
        {error && (
          <span style={{ fontSize:11, padding:"3px 8px", borderRadius:3, background:"var(--c-err-bg)", color:"var(--c-err)", border:"0.5px solid var(--c-err-border)", maxWidth:280, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{error}</span>
        )}
        {/* Window controls */}
        <div style={{ display:"flex", alignSelf:"stretch", marginLeft:4 }}>
          <button onClick={() => appWindow?.minimize()}
            style={{ width:46, height:"100%", background:"transparent", border:"none", color:"var(--c-muted)", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
            onMouseEnter={e => e.currentTarget.style.background="var(--c-hover2)"}
            onMouseLeave={e => e.currentTarget.style.background="transparent"}
          >─</button>
          <button onClick={() => appWindow?.toggleMaximize()}
            style={{ width:46, height:"100%", background:"transparent", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
            onMouseEnter={e => e.currentTarget.style.background="var(--c-hover2)"}
            onMouseLeave={e => e.currentTarget.style.background="transparent"}
          >
            <div style={{ width:10, height:10, border:"1.5px solid var(--c-muted)", borderRadius:1 }} />
          </button>
          <button onClick={() => appWindow?.close()}
            style={{ width:46, height:"100%", background:"transparent", border:"none", color:"var(--c-muted)", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
            onMouseEnter={e => { e.currentTarget.style.background="#c0392b"; e.currentTarget.style.color="#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="var(--c-muted)"; }}
          >✕</button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div ref={splitContainerRef} style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── Raw JSON panel ──────────────────────────────────────────── */}
        <div style={{ width:`${splitPos}%`, minWidth:180, display:"flex", flexDirection:"column", overflow:"hidden", borderRight:"none" }}>

          {/* Section header */}
          <div style={{ padding:"5px 12px", fontSize:11, color:"var(--c-dim)", background:"var(--c-surface-alt)", borderBottom:"0.5px solid var(--c-border-soft)", textTransform:"uppercase", letterSpacing:"0.08em", display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            <span style={{ marginRight:"auto" }}>raw json</span>
            {rawMode === "edit" && (
              <span
                onClick={() => openFind(false)}
                title="Ctrl+F"
                style={{ cursor:"pointer", fontSize:10, color: findOpen ? "var(--c-active)" : "var(--c-dim)", userSelect:"none" }}
              >⌕ find</span>
            )}
            {rawMode === "view" && parsed !== null && (
              <>
                <span onClick={rawExpandAll}   style={{ cursor:"pointer", fontSize:10, color:"var(--c-dim)", userSelect:"none" }}>expand all</span>
                <span onClick={rawCollapseAll} style={{ cursor:"pointer", fontSize:10, color:"var(--c-dim)", userSelect:"none" }}>collapse all</span>
              </>
            )}
            {parsed !== null && (
              <span
                onClick={() => { setRawMode(m => m === "edit" ? "view" : "edit"); setFindOpen(false); }}
                style={{ cursor:"pointer", fontSize:10, color: rawMode === "view" ? "var(--c-active)" : "var(--c-dim)", userSelect:"none", letterSpacing:"0.05em" }}
              >
                {rawMode === "edit" ? "fold view" : "edit"}
              </span>
            )}
          </div>

          {/* Find / replace bar */}
          {findOpen && rawMode === "edit" && (
            <div style={{ background:"var(--c-find-bar)", borderBottom:"0.5px solid var(--c-border-soft)", padding:"6px 10px", display:"flex", flexDirection:"column", gap:5, flexShrink:0 }}>
              {/* Find row */}
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={e => setFindQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter")  { e.shiftKey ? findPrevMatch() : findNextMatch(); }
                    if (e.key === "Escape") closeFind();
                  }}
                  placeholder="find…"
                  style={findInputStyle}
                />
                {/* Match counter */}
                <span style={{ fontSize:11, color:"var(--c-dim)", minWidth:54, textAlign:"center", letterSpacing:"0.03em" }}>
                  {findMatches.length
                    ? `${findMatchIdx + 1} / ${findMatches.length}`
                    : findQuery ? <span style={{ color:"#7a3a3a" }}>no match</span> : ""}
                </span>
                <button style={S.small} onClick={findPrevMatch} title="Shift+Enter / ↑ prev">↑</button>
                <button style={S.small} onClick={findNextMatch} title="Enter / ↓ next">↓</button>
                {/* Case-sensitive toggle */}
                <button
                  onClick={() => setFindCase(c => !c)}
                  title="case sensitive"
                  style={{ ...S.small, color: findCase ? "var(--c-active)" : "var(--c-muted)", borderColor: findCase ? "var(--c-active)" : "var(--c-btn-border)" }}
                >Aa</button>
                {/* Toggle replace row */}
                <button
                  onClick={() => setShowReplace(r => !r)}
                  title="toggle replace"
                  style={{ ...S.small, color: showReplace ? "var(--c-active)" : "var(--c-muted)", borderColor: showReplace ? "var(--c-active)" : "var(--c-btn-border)", minWidth:18, textAlign:"center" }}
                >{showReplace ? "−" : "+"}</button>
                {/* Close */}
                <button onClick={closeFind} style={{ ...S.small, paddingLeft:5, paddingRight:5 }}>✕</button>
              </div>

              {/* Replace row */}
              {showReplace && (
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <input
                    value={replaceText}
                    onChange={e => setReplaceText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Escape") closeFind(); }}
                    placeholder="replace with…"
                    style={findInputStyle}
                  />
                  <button style={S.small} onClick={replaceOne} disabled={!findMatches.length}>replace</button>
                  <button style={S.small} onClick={replaceAll} disabled={!findMatches.length}>replace all</button>
                </div>
              )}
            </div>
          )}

          {/* Editor area */}
          <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
            {rawMode === "view" && parsed !== null ? (
              <FoldableRaw parsed={parsed} folded={rawFolded} onToggle={toggleRawFold} selectedPk={selectedPk} selectSeq={selectSeq} />
            ) : (
              <>
                {highlightLine !== null && (
                  <div style={{ position:"absolute", left:0, right:0, top: 12 + (highlightLine - 1) * 13 * 1.6, height: 13 * 1.6, background:"var(--c-line-bg)", pointerEvents:"none", zIndex:1 }}>
                    <div key={selectSeq} className="hl-flash" />
                  </div>
                )}
                <pre
                  ref={hlRef}
                  aria-hidden
                  style={{ position:"absolute", inset:0, margin:0, padding:12, fontFamily:"monospace", fontSize:13, lineHeight:1.6, background:"var(--c-bg)", color:"var(--c-text)", overflow:"hidden", pointerEvents:"none", whiteSpace:"pre-wrap", wordBreak:"break-all", boxSizing:"border-box" }}
                  dangerouslySetInnerHTML={{ __html: preHtml }}
                />
                <textarea
                  ref={taRef}
                  value={raw}
                  onChange={e => onInput(e.target.value)}
                  onScroll={syncScroll}
                  spellCheck={false}
                  placeholder="Paste JSON here…"
                  style={{ position:"absolute", inset:0, margin:0, padding:12, fontFamily:"monospace", fontSize:13, lineHeight:1.6, background:"transparent", color:"transparent", caretColor:"var(--c-text)", border:"none", outline:"none", resize:"none", boxSizing:"border-box", overflow:"auto" }}
                />
              </>
            )}
          </div>
        </div>

        {/* ── Resize divider ──────────────────────────────────────────── */}
        <div
          onMouseDown={onDividerMouseDown}
          style={{ width:4, flexShrink:0, cursor:"col-resize", background:"var(--c-divider-bg)", borderLeft:"0.5px solid var(--c-divider-brd)", borderRight:"0.5px solid var(--c-divider-brd)", transition:"background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background="var(--c-divider-hl)"}
          onMouseLeave={e => e.currentTarget.style.background="var(--c-divider-bg)"}
        />

        {/* ── Tree preview panel ──────────────────────────────────────── */}
        <div style={{ flex:1, minWidth:180, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"5px 12px", fontSize:11, color:"var(--c-dim)", background:"var(--c-surface-alt)", borderBottom:"0.5px solid var(--c-border-soft)", textTransform:"uppercase", letterSpacing:"0.08em", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ marginRight:"auto" }}>tree preview</span>
            {parsed !== null && (
              <>
                <span onClick={treeExpandAll}   style={{ cursor:"pointer", fontSize:10, color:"var(--c-dim)", userSelect:"none" }}>expand all</span>
                <span onClick={treeCollapseAll} style={{ cursor:"pointer", fontSize:10, color:"var(--c-dim)", userSelect:"none" }}>collapse all</span>
              </>
            )}
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"10px 8px" }}>
            {parsed !== null
              ? <Node val={parsed} path={[]} root={parsed} onUpdate={onUpdate} treeForce={treeForce} onSelect={handleSelect} selectedPk={selectedPk} selectSeq={selectSeq} />
              : <span style={{ color:"var(--c-muted)", fontSize:12, padding:12, display:"block" }}>Paste valid JSON on the left.</span>
            }
          </div>
        </div>
      </div>

      {/* ── Download bar (web only) ─────────────────────────────────────── */}
      {!appWindow && (
        <div style={{ position:"fixed", bottom:20, left:"50%", transform:"translateX(-50%)", zIndex:9998, display:"flex", alignItems:"center", gap:8, background:"var(--c-surface)", border:"0.5px solid var(--c-border)", borderRadius:32, padding:"6px 14px 6px 12px", boxShadow:"0 4px 24px rgba(0,0,0,0.18)" }}>
          <span style={{ fontSize:10, color:"var(--c-muted)", letterSpacing:"0.08em", textTransform:"uppercase", marginRight:2 }}>Download</span>
          <a
            href="/downloads/JsonEditor_0.1.0_aarch64.dmg"
            download
            style={{ display:"flex", alignItems:"center", gap:6, background:"var(--c-btn-bg)", border:"0.5px solid var(--c-btn-border)", color:"var(--c-btn-text)", padding:"4px 12px", borderRadius:20, fontSize:11, fontFamily:"monospace", textDecoration:"none", cursor:"pointer", transition:"border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor="var(--c-active)"}
            onMouseLeave={e => e.currentTarget.style.borderColor="var(--c-btn-border)"}
          >
            {/* Apple logo */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.37 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            macOS
          </a>
          <a
            href="/downloads/JsonEditor_0.1.0.zip"
            download
            style={{ display:"flex", alignItems:"center", gap:6, background:"var(--c-btn-bg)", border:"0.5px solid var(--c-btn-border)", color:"var(--c-btn-text)", padding:"4px 12px", borderRadius:20, fontSize:11, fontFamily:"monospace", textDecoration:"none", cursor:"pointer", transition:"border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor="var(--c-active)"}
            onMouseLeave={e => e.currentTarget.style.borderColor="var(--c-btn-border)"}
          >
            {/* Windows 11 logo */}
            <svg width="13" height="13" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4"  y="4"  width="37" height="37" rx="4" fill="#F25022"/>
              <rect x="47" y="4"  width="37" height="37" rx="4" fill="#7FBA00"/>
              <rect x="4"  y="47" width="37" height="37" rx="4" fill="#00A4EF"/>
              <rect x="47" y="47" width="37" height="37" rx="4" fill="#FFB900"/>
            </svg>
            Windows
          </a>
        </div>
      )}

      {/* ── Product Hunt badge (web only) ───────────────────────────────── */}
      {!appWindow && (
        <a
          href="https://www.producthunt.com/products/simple-json-editor?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-jsonedit-app"
          target="_blank"
          rel="noopener noreferrer"
          style={{ position:"fixed", bottom:16, right:16, zIndex:9999, lineHeight:0 }}
        >
          <img
            alt="jsonedit.app - JSON Editor is a lightweight desktop tool for developers. | Product Hunt"
            width="213"
            height="46"
            src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1139082&theme=light&t=1778086510968"
          />
        </a>
      )}
    </div>
  );
}
