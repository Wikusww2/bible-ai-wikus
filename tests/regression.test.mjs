import test from 'node:test';
import assert from 'node:assert/strict';
import {client,backend} from './helpers.mjs';
import {normalizeWorkspace,mergeWorkspace,attachmentError,writeLocal} from '../shared/workspace.js';
const state=sessions=>({settings:{},sessions,notes:[],topics:[]});
const session=(id,text='x')=>({id,title:id,updated:1,messages:[{role:'user',text}]});

test('invalid stored records are quarantined, valid records survive',()=>{const r=normalizeWorkspace(state([{},session('ok')]));assert.equal(r.rejected.length,1);assert.equal(r.state.sessions[0].id,'ok');});
test('merge preserves independent device additions',()=>{const merged=mergeWorkspace(state([]),state([session('a')]),state([session('b')]));assert.deepEqual(new Set(merged.sessions.map(s=>s.id)),new Set(['a','b']));});
test('merge keeps both independently changed copies',()=>{const merged=mergeWorkspace(state([session('a','base')]),state([session('a','left')]),state([session('a','right')]));assert.equal(merged.sessions.length,2);assert.match(merged.sessions[1].id,/conflict/);});
test('merge does not resurrect a deleted unchanged record',()=>{const local={...state([]),deletedSessions:{a:100}};assert.equal(mergeWorkspace(state([session('a')]),local,state([session('a')])).sessions.length,0);});
test('recently used old chats are not silently capped at sixty',()=>{assert.equal(normalizeWorkspace(state(Array.from({length:70},(_,i)=>session(String(i))))).state.sessions.length,70);});
test('storage quota reports failure rather than throwing',()=>assert.equal(writeLocal({setItem(){throw new DOMException('full','QuotaExceededError')}},state([])),false));
test('attachment preflight applies combined input limit',()=>assert.match(attachmentError(Array.from({length:3},()=>({name:'a.pdf',size:20_000_000}))),/50 MB/));
test('unsupported stored binaries cannot be submitted to AI',()=>assert.match(attachmentError([{name:'archive.exe',size:2}]),/format/));
test('verse list ranges work in either order',async()=>{const c=await client();assert.deepEqual([...c.RefParser.parse('John 3:16,18-20').verses],[16,18,19,20]);assert.ok(c.RefParser.parse('John 3:16-18,20'));});
test('chapter ranges remain on deterministic path',async()=>{const c=await client();assert.equal(c.RefParser.parse('Genesis 1-3').chapterEnd,3);});
test('verse zero fails at the parser boundary',async()=>{const c=await client();assert.ok(c.RefParser.parse('John 3:0').error);});
test('retrieval rejects clipped impossible range',async()=>{const c=await client();c.BibleProvider.getChapter=async()=>Array.from({length:36},(_,i)=>({verse:i+1,text:'fixture'}));await assert.rejects(()=>c.BibleProvider.getPassage(c.RefParser.parse('John 3:16-999 WEB')),/outside/);});
test('provider rate-limit errors do not substitute a translation',async()=>{const c=await client();c.BibleProvider.getChapter=async()=>{throw new Error('Scripture provider returned 429')};await assert.rejects(()=>c.BibleProvider.getPassage(c.RefParser.parse('John 3:16 CSB')),/429/);});
test('mismatched manuscript numbering disables unverified word links',async()=>{const c=await client();c.OriginalProvider.fetchChapterRaw=async code=>code==='WLC'?[{verse:1,text:'title'},{verse:2,text:'original'}]:[{verse:1,text:'word<S>123</S>'}];const r=await c.OriginalProvider.getInterlinear(c.RefParser.parse('Psalm 3:1'));assert.equal(r.alignmentVerified,false);assert.equal(r.verses[0].words.length,0);assert.match(r.alignmentWarning,/numbering/);});
test('citation cleaner preserves ordinary cite and cited prose',async()=>{const c=await client();assert.equal(c.cleanCitationArtifacts('Please cite the cited sources.'),'Please cite the cited sources.');});
test('clean EOF before response.completed is interrupted',async()=>{const c=await client();const run=new c.AgentRun({session:{},onEvent(){}});await assert.rejects(()=>run.consumeStream(new Response('data: '+JSON.stringify({type:'response.created',response:{id:'resp_fixture'}})+'\n\n')),/before/);});
test('cancelled background responses are not successful answers',async()=>{const c=await client();const run=new c.AgentRun({session:{},onEvent(){}});assert.throws(()=>run.responseResult({id:'r',status:'cancelled'}),{name:'AbortError'});});
test('Stop settles a pending approval without allowing the tool',async()=>{const c=await client();const run=new c.AgentRun({session:{},onEvent(){}});const pending=run.requestApproval('fixture',{});run.cancel();assert.equal(await pending,false);});
test('usage recovery does not double count a response',async()=>{const c=await client();const run=new c.AgentRun({session:{},onEvent(){}});for(let i=0;i<2;i++)run.recordUsage({input_tokens:10,output_tokens:5,total_tokens:15},'gpt-5.6-terra','same');assert.equal(run.usage.totalTokens,15);});
test('none effort is explicitly sent',async()=>{const c=await client();c.Settings.data.apiKey='synthetic-test-value';c.Settings.data.reasoning='none';let body;const run=new c.AgentRun({session:{messages:[]},userText:'fixture',onEvent(){}});run.callModel=async b=>{body=b;return {}};run.consumeStream=async()=>({id:'r',functionCalls:[]});await run.run();assert.equal(body.reasoning.effort,'none');});
test('disabled registered tools cannot execute',async()=>{const c=await client();c.Settings.data.apiKey='synthetic-test-value';let executed=0;c.ToolRegistry.tools.disabled_fixture={name:'disabled_fixture',settingKey:'fetchPage',parameters:{properties:{}},label:()=>'',execute:async()=>{executed++;return {}}};const run=new c.AgentRun({session:{messages:[]},userText:'fixture',onEvent(){}});let n=0;run.callModel=async()=>({});run.consumeStream=async()=>++n===1?{id:'r',functionCalls:[{name:'disabled_fixture',call_id:'f',arguments:'{}'}]}:{id:'r2',functionCalls:[]};await run.run();assert.equal(executed,0);});
test('resumed completed tools reuse their saved output',async()=>{const c=await client();c.Settings.data.apiKey='synthetic-test-value';let executed=0;c.ToolRegistry.tools.create_artifact.execute=async()=>{executed++;return {}};const run=new c.AgentRun({session:{messages:[]},userText:'fixture',resumeState:{responseId:'r',completedTools:{f:{created:true}}},onEvent(){}});run.waitForBackground=async()=>({id:'r',functionCalls:[{name:'create_artifact',call_id:'f',arguments:'{"title":"x","format":"html","content":"x"}'}]});run.callModel=async()=>({});run.consumeStream=async()=>({id:'r2',functionCalls:[]});await run.run();assert.equal(executed,0);});
test('checkpoints include tool ledger and round budget',async()=>{const c=await client();const session={};const run=new c.AgentRun({session,onEvent(){}});run.responseId='r';run.completedTools.f={ok:true};run.rounds=2;run.checkpoint(true);assert.equal(session.pendingRun.rounds,2);assert.equal(session.pendingRun.completedTools.f.ok,true);});
test('standard Luna pricing matches the dated published rate',async()=>{const c=await client();assert.equal(c.estimateUsageCost({inputTokens:1_000_000,outputTokens:0},'gpt-5.6-luna',1).costUsd,.4);assert.equal(c.estimateUsageCost({inputTokens:100_000,outputTokens:0},'gpt-5.6-luna',1).costUsd,.02);});

test('backend rejects null JSON with a client error',async()=>{const b=await backend();for(const [url,method] of [['/api/sync','PUT'],['/api/artifacts','POST']]){const r=await b.call(url,{method,body:'null',headers:{'content-type':'application/json'}});assert.equal(r.status,400);}});
test('sync rejects stale writes and round-trips encrypted key',async()=>{const b=await backend();const payload=state([session('a')]);payload.settings.apiKey='synthetic-test-value';const put=rev=>b.call('/api/sync',{method:'PUT',body:JSON.stringify({state:payload,expectedRevision:rev}),headers:{'content-type':'application/json'}});const first=await put(0);assert.equal(first.status,200);assert.equal((await put(0)).status,409);const row=b.db.prepare('SELECT * FROM user_state').get();assert.ok(row.api_key_cipher);assert.ok(!row.state_json.includes('synthetic-test-value'));const data=await (await b.call('/api/sync')).json();assert.equal(data.state.settings.apiKey,'synthetic-test-value');});
test('cross-user and cross-origin boundaries remain intact',async()=>{const b=await backend();assert.equal((await b.call('/api/sync',{headers:{'oai-authenticated-user-email':''}})).status,401);assert.equal((await b.call('/api/sync',{headers:{origin:'https://other.invalid'}})).status,403);});
test('artifact retry with the same call id creates one file',async()=>{const b=await backend();const options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Fixture',format:'article',content:'First paragraph.\n\nSecond paragraph.',idempotencyKey:'call_fixture'})};const first=await (await b.call('/api/artifacts',options)).json();const second=await (await b.call('/api/artifacts',options)).json();assert.equal(first.artifact.id,second.artifact.id);assert.equal(b.objects.size,1);});
test('library pagination reaches file 251 and full wipe removes every file',async()=>{const b=await backend();await b.call('/api/files');const user=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test@example.invalid'));const userId=Buffer.from(user).toString('hex');const insert=b.db.prepare('INSERT INTO library_files VALUES (?,?,?,?,?,?,?,?,?,?)');for(let i=0;i<251;i++){insert.run('f'+i,userId,'x.txt','text/plain',1,'upload','txt','k'+i,'{}',i);b.objects.set('k'+i,'x');}let count=0,cursor=null;do{const data=await (await b.call('/api/files'+(cursor!==null?'?cursor='+cursor:''))).json();count+=data.files.length;cursor=data.nextCursor;}while(cursor!==null);assert.equal(count,251);assert.equal((await b.call('/api/files',{method:'DELETE'})).status,200);assert.equal(b.db.prepare('SELECT count(*) AS count FROM library_files').get().count,0);assert.equal(b.objects.size,0);});
test('active HTML keeps the opaque-origin CSP sandbox',async()=>{const b=await backend();const form=new FormData();form.append('file',new File(['<p>fixture</p>'],'a.html',{type:'text/html'}));const data=await (await b.call('/api/files',{method:'POST',body:form})).json();const r=await b.call(data.file.url);const csp=r.headers.get('content-security-policy');assert.match(csp,/sandbox/);assert.ok(!csp.includes('allow-same-origin'));});

test('delayed direct lookup saves only to its originating session',async()=>{
 const c=await client(),a={id:'a',messages:[]},b={id:'b',messages:[]};
 c.document.body={classList:{add(){},remove(){}}};c.document.createElement=()=>({replaceWith(){}});c.document.querySelector=()=>({appendChild(){}});
 c.App.scrollFeed=()=>{};c.App.renderMessage=()=>({});c.App.renderChat=()=>{};c.App.session=a;
 let release;c.BibleProvider.getPassage=()=>new Promise(resolve=>release=resolve);
 const pending=c.App.fastPassage(c.RefParser.parse('John 3:16 WEB'),'John 3:16 WEB',a);c.App.session=b;
 release({reference:'John 3:16',translation:'WEB',verses:[{verse:16,text:'fixture'}]});await pending;
 assert.equal(a.messages.length,1);assert.equal(b.messages.length,0);assert.equal(a.directContext.length,1);
});
test('edits made while a cloud PUT is in flight survive',async()=>{
 const c=await client();c.Store.hydrate(state([session('a')]));c.CloudSync.ready=true;c.CloudSync.base=structuredClone(c.CloudSync.snapshot());
 c.CloudSync.applyRemote=function(data){c.Store.hydrate(data);};let calls=0;
 c.CloudSync.request=async method=>{calls++;if(method==='PUT'){c.Store.sessions.push(session('during-save'));return new Response(JSON.stringify({updatedAt:2}));}return new Response(JSON.stringify({state:structuredClone(c.CloudSync.base),updatedAt:1}));};
 // Make a local edit so a PUT is required.
 c.Store.sessions[0].title='edited';await c.CloudSync.push();clearTimeout(c.CloudSync.timer);
 assert.equal(calls,2);assert.ok(c.Store.sessions.some(s=>s.id==='during-save'));
});
test('recovered citation offsets include earlier model rounds',async()=>{
 const c=await client(),run=new c.AgentRun({session:{},onEvent(){}});run.roundPrefix='Earlier. ';
 run.responseResult({id:'r',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'New fact.',annotations:[{type:'url_citation',url:'https://example.invalid',start_index:0,end_index:9}]}]}]});
 assert.equal(run.citations[0].end_index,18);assert.equal(run.text,'Earlier. New fact.');
});
test('restored artifact metadata survives a Library upload',async()=>{
 const b=await backend(),form=new FormData();form.append('file',new File(['<p>fixture</p>'],'study.html',{type:'text/html'}));form.append('restoreMetadata',JSON.stringify({kind:'created',format:'article',metadata:{title:'Restored study'}}));
 const response=await b.call('/api/files',{method:'POST',body:form});assert.equal(response.status,201);
 const {file}=await response.json();assert.equal(file.kind,'created');assert.equal(file.format,'article');assert.equal(file.metadata.title,'Restored study');
});
