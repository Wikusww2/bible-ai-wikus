/* Revision-checked, three-way sync. Conflicting copies remain available. */
'use strict';
const CloudSync = {
  ready:false,pushing:false,queued:false,timer:null,status:'local',revision:0,base:null,dirty:false,retries:0,disabled:false,
  notify(status,detail=''){this.status=status;window.App?.updateSyncStatus?.(status,detail);},
  snapshot(){return {settings:Settings.data,sessions:Store.sessions,notes:Store.notes,topics:Store.topics,trash:Store.trash||[],deletedSessions:Store.deletedSessions};},
  applyRemote(state){
    const currentId=window.App?.session?.id;
    Settings.hydrate(state.settings||{});Store.hydrate(state);Store.persist({markUpdated:false,sync:false});
    if(window.App?.session) App.session=Store.sessions.find(s=>s.id===currentId)||App.session;
    window.App?.applyTheme?.();window.App?.renderAll?.();
  },
  async request(method='GET',body){
    return fetch('/api/sync',{method,credentials:'same-origin',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  },
  async init(){
    this.base=Workspace.readLocal(localStorage)?.syncBase||null;
    this.revision=Number(Workspace.readLocal(localStorage)?.syncRevision)||0;
    this.dirty=Boolean(Workspace.readLocal(localStorage)?.dirty);
    if(location.protocol==='file:'){this.disabled=true;this.ready=true;this.notify('local','Cloud features require the hosted app.');return;}
    this.ready=true;
    await this.push();
    addEventListener('online',()=>this.schedule());
    addEventListener('focus',()=>this.schedule());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.schedule();});
    addEventListener('storage',event=>{if(event.key===Workspace.SNAPSHOT_KEY)this.schedule();});
  },
  schedule(){this.dirty=true;if(!this.ready||this.disabled)return;clearTimeout(this.timer);this.notify('pending','Changes waiting to sync…');this.timer=setTimeout(()=>this.push(),700);},
  async push(){
    if(!this.ready||this.disabled)return;
    if(this.pushing){this.queued=true;return;}
    if(window.App?.activeRun||window.App?.lookupRun){this.timer=setTimeout(()=>this.push(),2500);return;}
    this.pushing=true;this.notify('syncing','Checking and saving your workspace…');
    try{
      const response=await this.request();if(!response.ok)throw new Error(`Cloud sync unavailable (${response.status}).`);
      const remote=await response.json();if(remote.disabled){this.disabled=true;this.notify('local','Cloud sync is not configured on this host.');return;}
      if(window.App?.activeRun||window.App?.lookupRun){this.queued=true;return;}
      const local=structuredClone(this.snapshot());const merged=remote.state?Workspace.mergeWorkspace(this.base,local,remote.state):local;
      if(remote.state&&!this.base)merged.settings={...local.settings,...remote.state.settings};
      if(remote.state&&JSON.stringify(merged)===JSON.stringify(remote.state)){
        this.base=remote.state;this.revision=remote.updatedAt;this.dirty=false;this.applyRemote(merged);
      }else{
        const saved=await this.request('PUT',{state:merged,expectedRevision:Number(remote.updatedAt)||0});
        if(saved.status===409){this.queued=true;throw new Error('Another device saved first. Retrying with its changes.');}
        if(!saved.ok)throw new Error(`Cloud save unavailable (${saved.status}).`);
        const result=await saved.json();
        if(window.App?.activeRun||window.App?.lookupRun){this.queued=true;return;}
        const latest=this.snapshot(),changed=JSON.stringify(latest)!==JSON.stringify(local);
        this.base=merged;this.revision=result.updatedAt;this.dirty=changed;
        this.applyRemote(changed?Workspace.mergeWorkspace(local,latest,merged):merged);if(changed)this.queued=true;
      }
      this.retries=0;Store.persist({markUpdated:false,sync:false});this.notify('synced',`Last synced ${new Date(this.revision).toLocaleString()}`);
    }catch(error){this.dirty=true;this.notify('local',`${error.message} Unsynced work stays on this device.`);clearTimeout(this.timer);this.timer=setTimeout(()=>this.push(),Math.min(60000,1500*2**Math.min(this.retries++,5)));}
    finally{this.pushing=false;if(this.queued){this.queued=false;clearTimeout(this.timer);this.timer=setTimeout(()=>this.push(),800);}}
  },
  async clearRemote(){if(location.protocol==='file:')return;const response=await this.request('DELETE');if(!response.ok&&response.status!==404)throw new Error(`Cloud deletion failed (${response.status}).`);},
};
window.CloudSync=CloudSync;
