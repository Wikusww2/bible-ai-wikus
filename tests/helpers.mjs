import vm from 'node:vm';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import * as Workspace from '../shared/workspace.js';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const root=resolve(import.meta.dirname,'..');
export async function client(){
 const values=new Map();
 const ctx=vm.createContext({console,Workspace,structuredClone,Date,Math,JSON,URL,Map,Set,AbortController,AbortSignal,DOMException,Response,Request,Headers,Blob,File,TextEncoder,TextDecoder,ReadableStream,Intl,setTimeout,clearTimeout,location:{protocol:'file:'},document:{addEventListener(){},querySelector(){return null}},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},fetch:async()=>{throw new Error('No external network in unit tests');}});
 ctx.window=ctx;
 for(const file of ['js/bible.js','js/harness.js','js/sync.js','js/app.js'])vm.runInContext(await fs.readFile(resolve(root,file),'utf8'),ctx,{filename:file});
 ctx.Settings.load();ctx.Store.persist=()=>true;ctx.CloudSync.schedule=()=>{};ctx.App.updateSyncStatus=()=>{};
 return ctx;
}
let workerPromise;
async function workerModule(){
 if(!workerPromise)workerPromise=(async()=>{
   const folder=await fs.mkdtemp(resolve(tmpdir(),'bible-worker-tests-'));const outfile=resolve(folder,'worker.mjs');
   await build({entryPoints:[resolve(root,'worker/index.ts')],bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent',plugins:[
    {name:'raw-and-runtime',setup(build){
     build.onResolve({filter:/^vinext\//},args=>({path:args.path,namespace:'stub'}));
     build.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const DEFAULT_DEVICE_SIZES=[];export const DEFAULT_IMAGE_SIZES=[];export const handleImageOptimization=()=>new Response("Not available",{status:404});export default {fetch:()=>new Response("Not found",{status:404})};',loader:'js'}));
     build.onResolve({filter:/\?raw$/},args=>({path:resolve(args.resolveDir,args.path.replace(/\?raw$/,'')),namespace:'raw'}));
     build.onLoad({filter:/.*/,namespace:'raw'},async args=>({contents:await fs.readFile(args.path,'utf8'),loader:'text'}));
    }}]});
   return (await import(pathToFileURL(outfile))).default;
 })();return workerPromise;
}
export async function backend(){
 const worker=await workerModule(),db=new DatabaseSync(':memory:'),objects=new Map();
 const env={DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)}};}},FILES:{async put(k,b){objects.set(k,b)},async get(k){if(!objects.has(k))return null;const blob=new Blob([objects.get(k)]);return {size:blob.size,body:blob.stream()}},async delete(k){objects.delete(k)}},SYNC_ENCRYPTION_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),ASSETS:{async fetch(request){try{return new Response(await fs.readFile(resolve(root,'public',new URL(request.url).pathname.slice(1))))}catch{return new Response('missing',{status:404})}}}};
 const call=(path,options={})=>worker.fetch(new Request('https://audit.invalid'+path,{...options,headers:{'oai-authenticated-user-email':'test@example.invalid',...options.headers}}),env,{waitUntil(){}});
 return {call,env,db,objects};
}
