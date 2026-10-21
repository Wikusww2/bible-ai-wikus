/** Versioned workspace validation and a three-way merge shared by client and worker. */
export const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const records = (value, kind, rejected) => (Array.isArray(value) ? value : []).filter(row => {
  const valid = object(row) && typeof row.id === 'string' && row.id.length > 0 &&
    (kind !== 'sessions' || (Array.isArray(row.messages) && row.messages.every(m => object(m) && ['user','assistant'].includes(m.role) && (m.text == null || typeof m.text === 'string')))) &&
    (kind !== 'topics' || (typeof row.title === 'string' && typeof row.summary === 'string'));
  if (!valid) rejected.push({ kind, record: row });
  return valid;
});
export function normalizeWorkspace(value) {
  const source = object(value) ? value : {};
  const rejected = [];
  const state = { settings: object(source.settings) ? source.settings : {}, sessions: records(source.sessions, 'sessions', rejected), notes: records(source.notes, 'notes', rejected), topics: records(source.topics, 'topics', rejected), deletedSessions: object(source.deletedSessions) ? source.deletedSessions : {}, trash:records(source.trash,'sessions',rejected) };
  state.sessions = state.sessions.map(s => ({ title: '', mode: 'chat', created: 0, updated: 0, citations: [], ...s }));
  return { state, rejected };
}
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function mergeWorkspace(base, local, remote) {
  base = normalizeWorkspace(base).state; local = normalizeWorkspace(local).state; remote = normalizeWorkspace(remote).state;
  const deletedSessions = { ...remote.deletedSessions };
  for(const [id,time] of Object.entries(local.deletedSessions))deletedSessions[id]=Math.max(Number(time)||0,Number(deletedSessions[id])||0);
  const mergeRecords = kind => {
    const before = new Map(base[kind].map(row => [row.id,row]));
    const left = new Map(local[kind].map(row => [row.id,row]));
    const right = new Map(remote[kind].map(row => [row.id,row]));
    const output = [];
    for (const id of new Set([...left.keys(),...right.keys()])) {
      const l=left.get(id), r=right.get(id), b=before.get(id);
      if (kind === 'sessions' && deletedSessions[id] && Math.max(l?.updated||0,r?.updated||0) <= deletedSessions[id]) continue;
      if (!l) { if (!b || !equal(r,b)) output.push(r); continue; }
      if (!r) { if (!b || !equal(l,b)) output.push(l); continue; }
      if (equal(l,r) || equal(r,b)) { output.push(l); continue; }
      if (equal(l,b)) { output.push(r); continue; }
      // Keep both independently modified copies; never discard a conflict by device clock.
      output.push(r);
      const suffix = fingerprint(JSON.stringify(l));
      output.push({ ...l, id: `${id}-conflict-${suffix}`, title: `${l.title||'Saved item'} (device conflict)`, pendingRun: undefined });
    }
    return output.sort((a,b)=>(b.updated||b.created||0)-(a.updated||a.created||0));
  };
  const settings={...remote.settings};
  for (const [key,value] of Object.entries(local.settings)) if (!equal(value,base.settings[key])) settings[key]=value;
  return {settings,sessions:mergeRecords('sessions'),notes:mergeRecords('notes'),topics:mergeRecords('topics'),trash:mergeRecords('trash'),deletedSessions};
}
function fingerprint(text) { let h=2166136261; for(const c of text) h=Math.imul(h^c.charCodeAt(0),16777619); return (h>>>0).toString(36); }
export const SNAPSHOT_KEY='bibleai.workspace.v2';
export function readLocal(storage) { try { const value=storage.getItem(SNAPSHOT_KEY); return value ? JSON.parse(value) : null; } catch { return null; } }
export function writeLocal(storage, state) { try { storage.setItem(SNAPSHOT_KEY,JSON.stringify(state)); return true; } catch { return false; } }
export function attachmentError(files) {
  if (files.reduce((sum,f)=>sum+Number(f.size||0),0)>50_000_000) return 'Attachments must total 50 MB or less per message.';
  const supported=/\.(pdf|txt|md|csv|json|html|xml|js|ts|py|docx|pptx|xlsx|jpg|jpeg|png|webp|gif)$/i;
  if (files.some(f=>!supported.test(f.name||''))) return 'This file can stay in your Library, but its format is not supported for AI input. Use a document, text file, PNG, JPEG or WebP.';
  return null;
}
