import { createStudyPdf } from "./pdf";
import { normalizeWorkspace } from "../shared/workspace.js";
import vendorJs from "../js/vendor.js?raw";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import indexHtml from "../index.html?raw";
import appCss from "../css/app.css?raw";
import bibleJs from "../js/bible.js?raw";
import harnessJs from "../js/harness.js?raw";
import syncJs from "../js/sync.js?raw";
import appJs from "../js/app.js?raw";
import { LIBRARY_FILES_SCHEMA_SQL, USER_STATE_SCHEMA_SQL } from "../db/schema";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | Blob | string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  SYNC_ENCRYPTION_KEY?: string;
  OWNER_EMAIL?: string;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const textAssets = new Map<string, { body: string; contentType: string }>([
  ["/css/app.css", { body: appCss, contentType: "text/css; charset=utf-8" }],
  ["/js/vendor.js", {body:vendorJs,contentType:"text/javascript; charset=utf-8"}],
  ["/js/bible.js", { body: bibleJs, contentType: "text/javascript; charset=utf-8" }],
  ["/js/harness.js", { body: harnessJs, contentType: "text/javascript; charset=utf-8" }],
  ["/js/sync.js", { body: syncJs, contentType: "text/javascript; charset=utf-8" }],
  ["/js/app.js", { body: appJs, contentType: "text/javascript; charset=utf-8" }],
]);

function withHeaders(body: BodyInit | null, contentType: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300, must-revalidate",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

function json(data: unknown, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function safeFileName(value: string) {
  return String(value || "file").replace(/[\\/\0\r\n]/g, "-").replace(/[^\p{L}\p{N}._()\- ]/gu, "").trim().slice(0, 120) || "file";
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function stripMarkup(value: string) {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim();
}

function artifactDocument(title: string, content: string, format: string) {
  if (/^\s*<!doctype html|^\s*<html[\s>]/i.test(content)) return content;
  const body = format === "article"
    ? `<article><h1>${escapeHtml(title)}</h1>${content.split(/\n\s*\n/).map(part=>`<p>${escapeHtml(part).replace(/\n/g,"<br>")}</p>`).join("")}</article>`
    : content;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:clamp(20px,5vw,64px);font:16px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fbfaf6;color:#18211c}article{max-width:760px;margin:auto}h1,h2,h3{font-family:Georgia,serif;line-height:1.15;color:#17251d}a{color:#285c49}@media(prefers-color-scheme:dark){body{background:#111713;color:#e8eee9}h1,h2,h3{color:#f4f1e8}}</style></head><body>${body}</body></html>`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function userIdFor(request: Request, env?: Env) {
  const requestUrl = new URL(request.url);
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase()
    || ((requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1") ? "local-development@bible-ai.invalid" : "");
  if (!email || (env?.OWNER_EMAIL && email!==env.OWNER_EMAIL.toLowerCase().trim())) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey(secret: string) {
  const raw = base64ToBytes(secret);
  if (raw.byteLength !== 32) throw new Error("SYNC_ENCRYPTION_KEY must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptApiKey(value: string, userId: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) },
    await encryptionKey(secret),
    new TextEncoder().encode(value),
  );
  const payload = new Uint8Array(iv.byteLength + encrypted.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(encrypted), iv.byteLength);
  return bytesToBase64(payload);
}

async function decryptApiKey(value: string, userId: string, secret: string) {
  const payload = base64ToBytes(value);
  if (payload.byteLength < 29) throw new Error("Encrypted API key is invalid.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: payload.slice(0, 12), additionalData: new TextEncoder().encode(userId) },
    await encryptionKey(secret),
    payload.slice(12),
  );
  return new TextDecoder().decode(decrypted);
}

async function handleSync(request: Request, env: Env, url: URL) {
  if (!env?.DB || !env.SYNC_ENCRYPTION_KEY) {
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      if (request.method === "GET") return json({ state: null, updatedAt: 0, disabled: true });
      if (request.method === "DELETE") return json({ deleted: false, disabled: true });
      return json({ saved: false, updatedAt: Date.now(), disabled: true });
    }
    return json({ error: "Cloud sync is not configured." }, 503);
  }
  const userId = await userIdFor(request,env);
  if (!userId) return json({ error: "Sign in is required." }, 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Origin not allowed." }, 403);

  await env.DB.prepare(USER_STATE_SCHEMA_SQL).run();

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT state_json, api_key_cipher, updated_at FROM user_state WHERE user_id = ?")
      .bind(userId).first<{ state_json: string; api_key_cipher: string | null; updated_at: number }>();
    if (!row) return json({ state: null, updatedAt: 0 });
    const state = JSON.parse(row.state_json) as { settings?: Record<string, unknown> };
    state.settings = state.settings && typeof state.settings === "object" ? state.settings : {};
    state.settings.apiKey = row.api_key_cipher
      ? await decryptApiKey(row.api_key_cipher, userId, env.SYNC_ENCRYPTION_KEY)
      : "";
    return json({ state, updatedAt: row.updated_at });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM user_state WHERE user_id = ?").bind(userId).run();
    return json({ deleted: true });
  }

  if (request.method !== "PUT") return json({ error: "Method not allowed." }, 405);
  const contentLength = Number(request.headers.get("content-length")) || 0;
  if (contentLength > 3_000_000) return json({ error: "Workspace is too large to sync." }, 413);

  let body: { state?: Record<string, unknown>; expectedRevision?: number };
  try { body = await request.json() as { state?: Record<string, unknown> }; }
  catch { return json({ error: "Invalid JSON." }, 400); }
  const state = body?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return json({ error: "Invalid workspace state." }, 400);
  const settings = state.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return json({ error: "Invalid settings." }, 400);
  const parsed=normalizeWorkspace(state);
  if(parsed.rejected.length)return json({error:"Workspace records failed validation."},400);
  const sessions = parsed.state.sessions;
  const notes = Array.isArray(state.notes) ? state.notes : [];
  const topics = Array.isArray(state.topics) ? state.topics : [];
  const apiKey = String((settings as Record<string, unknown>).apiKey || "").trim().slice(0, 512);
  const safeSettings = { ...(settings as Record<string, unknown>) };
  delete safeSettings.apiKey;
  const stateJson = JSON.stringify({ settings: safeSettings, sessions, notes, topics, deletedSessions:parsed.state.deletedSessions, trash:Array.isArray(state.trash)?state.trash:[] });
  if (new TextEncoder().encode(stateJson).byteLength > 2_800_000) return json({ error: "Workspace is too large to sync." }, 413);
  const cipher = apiKey ? await encryptApiKey(apiKey, userId, env.SYNC_ENCRYPTION_KEY) : null;
  const expected=Number(body.expectedRevision);
  if(!Number.isSafeInteger(expected)||expected<0)return json({error:"A workspace revision is required."},409);
  const updatedAt=Math.max(Date.now(),expected+1);
  const saved=expected===0
    ? await env.DB.prepare("INSERT OR IGNORE INTO user_state (user_id,state_json,api_key_cipher,updated_at) VALUES (?,?,?,?) RETURNING updated_at").bind(userId,stateJson,cipher,updatedAt).first<{updated_at:number}>()
    : await env.DB.prepare("UPDATE user_state SET state_json=?, api_key_cipher=?, updated_at=? WHERE user_id=? AND updated_at=? RETURNING updated_at").bind(stateJson,cipher,updatedAt,userId,expected).first<{updated_at:number}>();
  if(!saved)return json({error:"Workspace changed on another device. Refresh before saving."},409);
  return json({saved:true,updatedAt});
}

type LibraryRow = {
  id: string; name: string; mime_type: string; size: number; kind: string; format: string;
  metadata_json: string; created_at: number;
};

function publicFile(row: LibraryRow) {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(row.metadata_json || "{}"); } catch {}
  return {
    id: row.id, name: row.name, mimeType: row.mime_type, size: row.size, kind: row.kind,
    format: row.format, createdAt: row.created_at, metadata,
    url: `/api/files/${encodeURIComponent(row.id)}`,
  };
}

async function ensureLibrary(env: Env) {
  await env.DB.prepare(LIBRARY_FILES_SCHEMA_SQL).run();
}

async function handleFiles(request: Request, env: Env, url: URL) {
  if (!env?.DB || !env?.FILES) return json({ error: "File library is not configured." }, 503);
  const userId = await userIdFor(request,env);
  if (!userId) return json({ error: "Sign in is required." }, 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Origin not allowed." }, 403);
  await ensureLibrary(env);
  const match = url.pathname.match(/^\/api\/files\/([^/]+)$/);

  if(!match && request.method==="DELETE"){
    // Delete in bounded pages; a failed object deletion retains its row for retry.
    while(true){const page=await env.DB.prepare("SELECT id,r2_key FROM library_files WHERE user_id=? LIMIT 100").bind(userId).all<{id:string;r2_key:string}>();if(!page.results.length)break;
      for(const row of page.results){await env.FILES.delete(row.r2_key);await env.DB.prepare("DELETE FROM library_files WHERE id=? AND user_id=?").bind(row.id,userId).run();}}
    return json({deleted:true});
  }
  if (!match && request.method === "GET") {
    const offset=Math.max(0,Math.min(1000000,Number(url.searchParams.get("cursor"))||0));
    const result = await env.DB.prepare("SELECT id, name, mime_type, size, kind, format, metadata_json, created_at FROM library_files WHERE user_id = ? ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?")
      .bind(userId,offset).all<LibraryRow>();
    return json({ files: result.results.map(publicFile), nextCursor:result.results.length===100?offset+100:null });
  }

  if (!match && request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length")) || 0;
    if (contentLength > 26_000_000) return json({ error: "Uploads must be 25 MB or smaller." }, 413);
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: "Invalid upload." }, 400); }
    const value = form.get("file");
    if (!(value instanceof File)) return json({ error: "Choose a file to upload." }, 400);
    if (value.size > 25_000_000) return json({ error: "Uploads must be 25 MB or smaller." }, 413);
    const id = crypto.randomUUID();
    const name = safeFileName(value.name || "upload");
    const mimeType = String(value.type || "application/octet-stream").slice(0, 160);
    let restored:{kind?:string;format?:string;metadata?:Record<string,unknown>}={};
    try{const raw=form.get('restoreMetadata');if(typeof raw==='string'&&raw.length<10000)restored=JSON.parse(raw);}catch{return json({error:'Invalid restore metadata.'},400);}
    const restoredFormat=String(restored?.format||'');
    const kind=restored?.kind==='created'&&['html','react','article','pdf'].includes(restoredFormat)?'created':'upload';
    const format=kind==='created'?restoredFormat:name.split('.').pop()?.toLowerCase()||'file';
    const metadataJson=kind==='created'?JSON.stringify({title:String(restored.metadata?.title||name).slice(0,120)}):'{}';
    const key = `${userId}/${id}/${name}`;
    await env.FILES.put(key, await value.arrayBuffer(), { httpMetadata: { contentType: mimeType } });
    const createdAt = Date.now();
    try{await env.DB.prepare("INSERT INTO library_files (id, user_id, name, mime_type, size, kind, format, r2_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, userId, name, mimeType, value.size, kind,format,key,metadataJson,createdAt).run();}catch(error){await env.FILES.delete(key);throw error;}
    return json({ file: publicFile({ id, name, mime_type: mimeType, size: value.size, kind,format,metadata_json:metadataJson,created_at:createdAt }) }, 201);
  }

  if (!match) return json({ error: "Method not allowed." }, 405);
  const id = decodeURIComponent(match[1]);
  const row = await env.DB.prepare("SELECT id, name, mime_type, size, kind, format, r2_key, metadata_json, created_at FROM library_files WHERE id = ? AND user_id = ?")
    .bind(id, userId).first<LibraryRow & { r2_key: string }>();
  if (!row) return json({ error: "File not found." }, 404);
  if (request.method === "DELETE") {
    await env.FILES.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM library_files WHERE id = ? AND user_id = ?").bind(id, userId).run();
    return json({ deleted: true });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed." }, 405);
  const object = await env.FILES.get(row.r2_key);
  if (!object) return json({ error: "Stored file is missing." }, 404);
  const download = url.searchParams.get("download") === "1";
  const headers = new Headers({
    "content-type": row.mime_type || object.httpMetadata?.contentType || "application/octet-stream",
    "content-length": String(object.size),
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
  });
  if (!download && /^(?:text\/html|image\/svg\+xml|application\/xhtml\+xml|(?:text|application)\/xml)(?:;|$)/i.test(row.mime_type)) {
    headers.set("content-security-policy", "sandbox allow-scripts allow-forms allow-modals; default-src https: data: blob:; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src https:");
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function handleArtifacts(request: Request, env: Env, url: URL) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env?.DB || !env?.FILES) return json({ error: "Artifact storage is not configured." }, 503);
  const userId = await userIdFor(request,env);
  if (!userId) return json({ error: "Sign in is required." }, 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Origin not allowed." }, 403);
  let body: { title?: string; format?: string; content?: string; idempotencyKey?: string };
  try { body = await request.json() as typeof body; } catch { return json({ error: "Invalid artifact." }, 400); }
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Invalid artifact."},400);
  const format = String(body.format || "article").toLowerCase();
  if (!["html", "react", "article", "pdf"].includes(format)) return json({ error: "Unsupported artifact format." }, 400);
  const title = safeFileName(String(body.title || "Created artifact")).slice(0, 80);
  const content = String(body.content || "");
  if (!content.trim() || new TextEncoder().encode(content).byteLength > 1_500_000) return json({ error: "Artifact content is empty or too large." }, 413);
  const token=String(body.idempotencyKey||crypto.randomUUID()).slice(0,180);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(userId+":"+token));
  const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  await ensureLibrary(env);
  const existing=await env.DB.prepare("SELECT id,name,mime_type,size,kind,format,metadata_json,created_at FROM library_files WHERE id=? AND user_id=?").bind(id,userId).first<LibraryRow>();
  if(existing)return json({artifact:publicFile(existing)});
  const isPdf = format === "pdf";
  const fonts=isPdf?await Promise.all(["NotoSans-Regular.ttf","NotoSansHebrew-Regular.ttf"].map(async name=>{const response=await env.ASSETS.fetch(new Request(new URL("/fonts/"+name,request.url)));if(!response.ok)throw new Error("Bundled PDF font unavailable.");return new Uint8Array(await response.arrayBuffer());})):[];
  const bytes = isPdf ? await createStudyPdf(title,content,fonts[0],fonts[1]) : new TextEncoder().encode(artifactDocument(title, content, format));
  const mimeType = isPdf ? "application/pdf" : "text/html; charset=utf-8";
  const name = `${title}.${isPdf ? "pdf" : "html"}`;
  const key = `${userId}/${id}/${name}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  const createdAt = Date.now();
  const metadataJson = JSON.stringify({ title, sourceFormat: format });
  await ensureLibrary(env);
  try{await env.DB.prepare("INSERT INTO library_files (id, user_id, name, mime_type, size, kind, format, r2_key, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)")
    .bind(id, userId, name, mimeType, bytes.byteLength, format, key, metadataJson, createdAt).run();}catch(error){const row=await env.DB.prepare("SELECT id,name,mime_type,size,kind,format,metadata_json,created_at FROM library_files WHERE id=? AND user_id=?").bind(id,userId).first<LibraryRow>();if(row)return json({artifact:publicFile(row)});await env.FILES.delete(key);throw error;}
  return json({ artifact: publicFile({ id, name, mime_type: mimeType, size: bytes.byteLength, kind: "created", format, metadata_json: metadataJson, created_at: createdAt }) }, 201);
}

async function handleFxRate() {
  try {
    const response = await fetch("https://api.frankfurter.dev/v2/rate/USD/ZAR?providers=SARB", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("FX provider failed");
    const data = await response.json() as { date?: string; rate?: number };
    if (!Number.isFinite(Number(data.rate)) || Number(data.rate) <= 0) throw new Error("Invalid FX rate");
    return json({ base: "USD", quote: "ZAR", date: data.date, rate: Number(data.rate), provider: "SARB via Frankfurter" }, 200, "public, max-age=21600");
  } catch {
    return json({ error: "Exchange rate unavailable." }, 502);
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = indexHtml.replaceAll("__SITE_ORIGIN__", url.origin);
      return withHeaders(request.method === "HEAD" ? null : body, "text/html; charset=utf-8");
    }

    try{
    if (url.pathname === "/api/sync") return await handleSync(request, env, url);
    if (url.pathname === "/api/fx" && request.method === "GET") return handleFxRate();
    if (url.pathname === "/api/files" || url.pathname.startsWith("/api/files/")) return await handleFiles(request, env, url);
    if (url.pathname === "/api/artifacts") return await handleArtifacts(request, env, url);

    }catch{return json({error:"The operation could not be completed. Your saved workspace has not been cleared; please retry."},500);}
    const textAsset = textAssets.get(url.pathname);
    if (textAsset) {
      return withHeaders(request.method === "HEAD" ? null : textAsset.body, textAsset.contentType);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
