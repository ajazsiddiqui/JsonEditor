import { useState, useRef } from "react";

function highlightJson(str) {
  const esc = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")\s*:|("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")|\b(true|false)\b|\b(null)\b|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g,
    (_, key, str, bool, nil, num, punct) => {
      if (key  !== undefined) return `<span style="color:#7a9ec0">${key}</span>:`;
      if (str  !== undefined) return `<span style="color:#7ec27e">${str}</span>`;
      if (bool !== undefined) return `<span style="color:#b07aba">${bool}</span>`;
      if (nil  !== undefined) return `<span style="color:#666">${nil}</span>`;
      if (num  !== undefined) return `<span style="color:#c09a5a">${num}</span>`;
      if (punct!== undefined) return `<span style="color:#555">${punct}</span>`;
      return _;
    }
  );
}

const C = {
  bg: "#111", surface: "#1a1a1a", border: "#2a2a2a",
  text: "#ccc", muted: "#555", key: "#7a9ec0",
  str: "#7ec27e", num: "#c09a5a", bool: "#b07aba", nil: "#666",
  ok: "#4caf7d", err: "#e06060",
};

const S = {
  btn: { background:"#222", border:"0.5px solid #333", color:"#aaa", padding:"4px 12px", borderRadius:3, cursor:"pointer", fontSize:12, fontFamily:"monospace" },
  small: { background:"#1c1c1c", border:"0.5px solid #333", color:"#888", padding:"1px 6px", borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:"monospace" },
  del: { background:"#1c1c1c", border:"0.5px solid #5a2020", color:"#a04040", padding:"1px 6px", borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:"monospace" },
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

function Node({ val, path, root, onUpdate }) {
  const [open, setOpen] = useState(true);
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
          style={{ background:"#1c1c1c", border:"0.5px solid #7a9ec0", color:C.key, padding:"1px 5px", borderRadius:3, fontFamily:"monospace", fontSize:12, outline:"none", minWidth:60 }}
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
      <span style={{ color: "#444", margin: "0 2px" }}>:</span>
    </>
  );

  let valEl;
  if (isObj) {
    valEl = <span style={{ color: C.muted, fontSize: 11 }}>{isArr ? `[ ${val.length} ]` : `{ ${Object.keys(val).length} }`}</span>;
  } else if (editing) {
    valEl = (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(draft); if (e.key === "Escape") setEditing(false); }}
        style={{ background:"#1c1c1c", border:"0.5px solid #555", color:"#ccc", padding:"1px 5px", borderRadius:3, fontFamily:"monospace", fontSize:12, outline:"none", minWidth:60 }}
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
      {path.length > 0 && <button style={S.del} onClick={e => { e.stopPropagation(); onUpdate(cloneDel(root, path)); }}>✕</button>}
    </span>
  );

  return (
    <div style={{ margin:"1px 0" }}>
      <div
        style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 4px", borderRadius:3, minHeight:22, background: hovered ? "#1e1e1e" : "transparent" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span
          style={{ width:14, fontSize:10, color:"#555", cursor: isObj ? "pointer" : "default", userSelect:"none", textAlign:"center", flexShrink:0 }}
          onClick={() => isObj && setOpen(o => !o)}
        >
          {isObj ? (open ? "▾" : "▸") : "·"}
        </span>
        {keyEl}
        {valEl}
        {acts}
      </div>
      {isObj && open && (
        <div style={{ paddingLeft:18, borderLeft:"0.5px solid #222", marginLeft:7 }}>
          {(isArr ? val.map((v,i) => [i,v]) : Object.entries(val)).map(([k,v]) => (
            <Node key={String(k)} val={v} path={[...path, k]} root={root} onUpdate={onUpdate} />
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
  const taRef = useRef(null);
  const hlRef = useRef(null);
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

  const onInput = (v) => { setRaw(v); setStatus(""); tryParse(v); };

  const onUpdate = (next) => {
    setParsed(next);
    setRaw(JSON.stringify(next, null, 2));
    setError("");
    setStatus("saved");
  };

  const format = () => { try { const p=JSON.parse(raw); const s=JSON.stringify(p,null,2); setRaw(s); setParsed(p); setStatus("formatted"); setError(""); } catch(e){setError(e.message);} };
  const minify = () => { try { const p=JSON.parse(raw); const s=JSON.stringify(p); setRaw(s); setParsed(p); setStatus("minified"); setError(""); } catch(e){setError(e.message);} };
  const clear  = () => { setRaw(INIT); setParsed({}); setError(""); setStatus(""); };

  return (
    <div style={{ background:C.bg, color:C.text, fontFamily:"monospace", fontSize:13, height:"100vh", display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:C.surface, borderBottom:`0.5px solid ${C.border}`, flexShrink:0 }}>
        <span style={{ fontSize:11, color:C.muted, marginRight:"auto", letterSpacing:"0.05em" }}>
          JSON TOOL made with ❤️ by ajazsiddiqui
        </span>
        <button style={S.btn} onClick={format}>format</button>
        <button style={S.btn} onClick={minify}>minify</button>
        <button style={{ ...S.btn, borderColor:"#5a2020", color:"#c05050" }} onClick={clear}>clear</button>
        {status && !error && (
          <span style={{ fontSize:11, padding:"3px 8px", borderRadius:3, background:"#0f2a1a", color:C.ok, border:"0.5px solid #1a4a2a" }}>{status}</span>
        )}
        {error && (
          <span style={{ fontSize:11, padding:"3px 8px", borderRadius:3, background:"#2a0f0f", color:C.err, border:"0.5px solid #4a1a1a", maxWidth:280, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{error}</span>
        )}
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        <div style={{ flex:1, display:"flex", flexDirection:"column", borderRight:`0.5px solid ${C.border}` }}>
          <div style={{ padding:"5px 12px", fontSize:11, color:"#444", background:"#151515", borderBottom:"0.5px solid #222", textTransform:"uppercase", letterSpacing:"0.08em" }}>raw json</div>
          <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
            <pre
              ref={hlRef}
              aria-hidden
              style={{ position:"absolute", inset:0, margin:0, padding:12, fontFamily:"monospace", fontSize:13, lineHeight:1.6, background:C.bg, color:C.text, overflow:"hidden", pointerEvents:"none", whiteSpace:"pre-wrap", wordBreak:"break-all", boxSizing:"border-box" }}
              dangerouslySetInnerHTML={{ __html: highlightJson(raw) + "\n" }}
            />
            <textarea
              ref={taRef}
              value={raw}
              onChange={e => onInput(e.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              placeholder="Paste JSON here…"
              style={{ position:"absolute", inset:0, margin:0, padding:12, fontFamily:"monospace", fontSize:13, lineHeight:1.6, background:"transparent", color:"transparent", caretColor:C.text, border:"none", outline:"none", resize:"none", boxSizing:"border-box", overflow:"auto" }}
            />
          </div>
        </div>

        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"5px 12px", fontSize:11, color:"#444", background:"#151515", borderBottom:"0.5px solid #222", textTransform:"uppercase", letterSpacing:"0.08em" }}>tree preview</div>
          <div style={{ flex:1, overflowY:"auto", padding:"10px 8px" }}>
            {parsed !== null
              ? <Node val={parsed} path={[]} root={parsed} onUpdate={onUpdate} />
              : <span style={{ color:"#333", fontSize:12, padding:12, display:"block" }}>Paste valid JSON on the left.</span>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
