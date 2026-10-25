import {DEFAULT_SETTINGS,STORAGE_KEY,MAX_FILE_BYTES,uid,responseText,validSettings,normalizeBackup,buildMessages,errorMessage,markdownExport} from './core.js';
import {renderMarkdown} from './markdown.js';
const $=s=>document.querySelector(s);
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const now=()=>new Date().toISOString();
let state={version:1,settings:{...DEFAULT_SETTINGS},chats:[],activeId:null};
let job=null, pendingFiles=[],catalog=[],toastTimer,storageWarning=false,frame=null;
const drafts=new Map();
try{
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw){const parsed=JSON.parse(raw);const activeIndex=parsed.chats?.findIndex(c=>c.id===parsed.activeId);state=normalizeBackup(parsed);state.activeId=state.chats[activeIndex>=0?activeIndex:0]?.id||null;}
}catch(e){setTimeout(()=>notify('Saved history could not be loaded. Export any recoverable browser data before clearing storage.'),500);}
function save(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));storageWarning=false;}
  catch{if(!storageWarning){notify('Browser storage is full or unavailable. Export a backup now; changes may not survive a reload.',10000);storageWarning=true;}}
}
function notify(text,duration=5000){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,duration);}
function announce(text){$('#live-status').textContent=text;}
function current(){return state.chats.find(c=>c.id===state.activeId);}
function applyTheme(){const pref=state.settings.theme;const theme=pref==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):pref;document.documentElement.dataset.theme=theme;}
applyTheme();matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
function nearBottom(){const n=$('#scroll-area');return n.scrollHeight-n.scrollTop-n.clientHeight<130;}
function scrollBottom(force=false){if(force||nearBottom()){$('#scroll-area').scrollTop=$('#scroll-area').scrollHeight;$('#jump-bottom').hidden=true;}}
function renderSidebar(){
  const container=$('#chat-list');container.replaceChildren();const term=$('#search').value.trim().toLowerCase();
  const chats=[...state.chats].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).filter(c=>c.title.toLowerCase().includes(term)||c.messages.some(m=>m.content.toLowerCase().includes(term)));
  $('#chat-count').textContent=state.chats.length;
  if(!chats.length){container.append(make('p','empty-history',term?'No conversations found.':'Your next idea starts here.\nStart a conversation to save it.'));return;}
  for(const c of chats){
    const row=make('div','chat-row'+(c.id===state.activeId?' active':''));
    const open=make('button','chat-link',c.title);open.title=c.title;open.setAttribute('aria-current',c.id===state.activeId?'page':'false');open.onclick=()=>switchChat(c.id);
    const rename=make('button','row-action','···');rename.title='Rename conversation';rename.setAttribute('aria-label','Rename '+c.title);rename.onclick=()=>{if(job)return notify('Stop the current response before renaming.');const title=prompt('Conversation title',c.title);if(title?.trim()){c.title=title.trim().slice(0,160);save();renderSidebar();updateTitle();}};
    const remove=make('button','row-action','×');remove.title='Delete conversation';remove.setAttribute('aria-label','Delete '+c.title);remove.onclick=()=>{if(job)return notify('Stop the current response before deleting.');if(confirm(`Delete “${c.title}”? This cannot be undone.`)){state.chats=state.chats.filter(x=>x.id!==c.id);drafts.delete(c.id);if(state.activeId===c.id)state.activeId=null;save();render();}};
    row.append(open,rename,remove);container.append(row);
  }
}
function updateTitle(){const title=current()?.title||'New conversation';$('#conversation-title').textContent=title;document.title=title==='New conversation'?'Atelier — AI, thoughtfully':`${title} — Atelier`;}
function renderMessages(){
  const container=$('#messages');container.replaceChildren();const c=current();$('#welcome').hidden=Boolean(c?.messages.length);
  if(!c)return;
  for(const m of c.messages){
    const article=make('article',`message ${m.role}`);article.dataset.messageId=m.id;
    const header=make('div','message-header');header.append(make('span','avatar',m.role==='user'?'Y':'✳'),make('span','',m.role==='user'?'You':'Atelier'));
    const time=make('time','',new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));time.dateTime=m.createdAt;header.append(time);
    const body=make('div','message-content');
    if(m.content){if(m.role==='assistant')body.append(renderMarkdown(m.content));else body.textContent=m.content;}
    else if(m.status==='streaming')body.append(make('span','thinking','Thinking it through…'));
    article.append(header,body);
    if(m.attachments?.length)article.append(make('div','attached-label','Files: '+m.attachments.map(a=>a.name).join(', ')));
    if(m.status==='error')article.append(make('div','message-state error',m.error||'Unable to complete response.'));
    if(m.status==='stopped')article.append(make('div','message-state','Response stopped.'));
    if(m.role==='assistant'&&m.status==='complete'&&m.model)article.append(make('div','message-state',m.model));
    const actions=make('div','message-actions');
    const action=(label,fn)=>{const b=make('button','',label);b.type='button';b.onclick=fn;b.disabled=Boolean(job);actions.append(b);};
    if(m.content)action('Copy',()=>copyText(m.content));
    if(m.role==='user')action('Edit & resend',()=>editMessage(m.id));
    if(m.role==='assistant'&&m===c.messages.at(-1))action(m.status==='error'?'Retry':'Regenerate',()=>regenerate(m.id));
    if(actions.childNodes.length)article.append(actions);container.append(article);
  }
}
function render(){renderSidebar();updateTitle();renderMessages();setBusy();}
function setBusy(){
  $('#send').hidden=Boolean(job);$('#stop').hidden=!job;$('#stop').disabled=Boolean(job?.controller.signal.aborted);
  $('#send').disabled=!$('#prompt').value.trim()||Boolean(job);
  $('#attach').disabled=Boolean(job);$('#model-select').disabled=Boolean(job);$('#new-chat').disabled=Boolean(job);
  $('#messages').setAttribute('aria-busy',String(Boolean(job)));
}
function stashDraft(){drafts.set(state.activeId||'new',{text:$('#prompt').value,files:pendingFiles});}
function restoreDraft(){const d=drafts.get(state.activeId||'new');$('#prompt').value=d?.text||'';pendingFiles=d?.files||[];resizePrompt();renderFiles();setBusy();}
function switchChat(id){if(job){notify('Stop the current response before switching conversations.');return;}stashDraft();state.activeId=id;restoreDraft();save();render();closeNav();requestAnimationFrame(()=>scrollBottom(true));}
function newChat(){if(job)return;stashDraft();state.activeId=null;restoreDraft();save();render();closeNav();$('#prompt').focus();}
function createChat(){const c={id:uid(),title:'New conversation',createdAt:now(),updatedAt:now(),messages:[]};state.chats.unshift(c);state.activeId=c.id;return c;}
function resizePrompt(){const t=$('#prompt');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,210)+'px';}
async function send(){
  const text=$('#prompt').value.trim();if(job||!text)return;
  if(!window.puter?.ai?.chat)return notify('Puter.js is not loaded. Check your internet connection or content blocker, then reload.');
  if(state.chats.length>=500&&!current())return notify('Conversation limit reached. Export a backup and remove older chats.');
  const c=current()||createChat();if(c.messages.length>=2000)return notify('This conversation is very long. Start a new one.');
  const m={id:uid(),role:'user',content:text,attachments:pendingFiles.map(a=>({...a})),createdAt:now(),status:'complete'};
  c.messages.push(m);if(c.messages.length===1)c.title=text.replace(/\s+/g,' ').slice(0,60);c.updatedAt=now();
  $('#prompt').value='';pendingFiles=[];drafts.delete('new');drafts.delete(c.id);resizePrompt();renderFiles();save();await generate(c);
}
async function generate(c){
  const assistant={id:uid(),role:'assistant',content:'',createdAt:now(),status:'streaming',model:state.settings.model};
  const settings={...state.settings};c.messages.push(assistant);
  const controller=new AbortController();job={controller,chatId:c.id};render();scrollBottom(true);announce('Assistant is responding.');
  let lastSave=Date.now();
  try{
    // Snapshot the full conversation before this new assistant message.
    const messages=buildMessages(c,settings,assistant.id);
    const response=await window.puter.ai.chat(messages,{model:settings.model,stream:true,max_tokens:settings.maxTokens,signal:controller.signal});
    if(controller.signal.aborted)throw new DOMException('Stopped','AbortError');
    if(response&&typeof response[Symbol.asyncIterator]==='function'){
      for await(const part of response){
        if(controller.signal.aborted)break;
        if(part?.type==='error'||part?.error)throw part.error||part;
        if(typeof part?.text==='string')assistant.content+=part.text;
        // Never show or store private reasoning. Text-only assistant output.
        if(assistant.content.length>1000000){controller.abort();throw new Error('Response exceeded the local safety limit.');}
        scheduleStreamRender(assistant);
        if(Date.now()-lastSave>1500){save();lastSave=Date.now();}
      }
    }else assistant.content=responseText(response);
    if(controller.signal.aborted)assistant.status='stopped';
    else if(!assistant.content.trim())throw new Error('The model returned no text. Try another model or retry.');
    else assistant.status='complete';
  }catch(error){
    if(controller.signal.aborted||error?.name==='AbortError')assistant.status='stopped';
    else{assistant.status='error';assistant.error=errorMessage(error);notify(assistant.error,8000);}
  }finally{
    if(frame){cancelAnimationFrame(frame);frame=null;}
    job=null;c.updatedAt=now();save();const follow=nearBottom();render();if(follow)scrollBottom(true);announce(assistant.status==='complete'?'Response complete.':assistant.status==='stopped'?'Response stopped.':'Response failed.');$('#prompt').focus();
  }
}
function scheduleStreamRender(m){
  if(frame)return;frame=requestAnimationFrame(()=>{frame=null;const follow=nearBottom();const body=$(`[data-message-id="${m.id}"] .message-content`);if(body){body.replaceChildren(renderMarkdown(m.content));if(follow)scrollBottom(true);}});
}
function regenerate(id){
  if(job)return;const c=current();const index=c?.messages.findIndex(m=>m.id===id);if(index<0||index===undefined)return;
  // A failed/stopped last response is discarded, not replayed to the provider.
  c.messages.splice(index);generate(c);
}
function editMessage(id){
  if(job)return;const c=current();const index=c.messages.findIndex(m=>m.id===id);const m=c.messages[index];
  if(!confirm('Edit this message? Sending it again replaces this message and all later replies.'))return;
  $('#prompt').value=m.content;pendingFiles=(m.attachments||[]).map(a=>({...a}));c.messages.splice(index);c.updatedAt=now();save();render();renderFiles();resizePrompt();setBusy();$('#prompt').focus();
}
async function copyText(text){try{await navigator.clipboard.writeText(text);notify('Copied to clipboard.');}catch{notify('Clipboard access was blocked. Select the text and copy it manually.');}}
$('#messages').addEventListener('click',e=>{const button=e.target.closest('.copy-code');if(button)copyText(button.dataset.code);});
function renderFiles(){const list=$('#attachments');list.replaceChildren();pendingFiles.forEach((file,index)=>{const chip=make('div','attachment');chip.append(make('span','',`File: ${file.name}`));const remove=make('button','','×');remove.type='button';remove.setAttribute('aria-label','Remove '+file.name);remove.onclick=()=>{pendingFiles.splice(index,1);renderFiles();};chip.append(remove);list.append(chip);});}
$('#attach').onclick=()=>$('#file-input').click();
$('#file-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;if(job)return notify('Wait for the response before adding a file.');
  if(pendingFiles.length>=3)return notify('Attach up to three text files per message.');
  if(file.size>MAX_FILE_BYTES)return notify('This file is too large. The limit is 100 KB per text file.');
  if(!/\.(txt|md|csv|json|[cm]?js|ts|tsx|jsx|py|html|css|xml|yaml|yml|log|sql|sh|rs|go|java|c|cpp|rb)$/i.test(file.name))return notify('Use a supported plain-text or code file. PDF, image, and binary attachments are not supported.');
  try{const text=await file.text();if(text.includes('\u0000'))throw new Error('Binary files are not supported.');pendingFiles.push({name:file.name.slice(0,200),text});renderFiles();$('#prompt').focus();}catch(error){notify(error.message||'Unable to read file.');}
};
function renderModels(){
  const select=$('#model-select');select.replaceChildren();const selected=state.settings.model;
  const models=[...catalog];if(!models.some(m=>m.id===selected))models.unshift({id:selected,name:selected.replace(/^anthropic\//,'').replace(/-/g,' ')});
  for(const model of models){const option=make('option','',model.name||model.id);option.value=model.id;option.title=model.id;select.append(option);}
  select.value=selected;
  if(catalog.length){const found=catalog.some(m=>m.id===selected||m.aliases?.includes(selected));$('#catalog-status').textContent=`${catalog.length} Claude models loaded. ${found?'Your selected ID is listed.':'Your selected ID was not found; choose a listed model or verify its alias with Puter.'}`;}
}
async function loadModels(){
  $('#refresh-models').disabled=true;$('#catalog-status').textContent='Loading available models…';
  try{
    if(!window.puter?.ai?.listModels)throw new Error('Puter.js is not loaded. Check your connection and reload.');
    const result=await window.puter.ai.listModels();if(!Array.isArray(result))throw new Error('Unexpected model catalog response.');
    // Stay focused on Claude. Exact IDs are passed through unchanged.
    catalog=result.filter(m=>typeof m.id==='string'&&/claude|anthropic/i.test(m.id+' '+(m.provider||'')+' '+(m.name||''))).sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id));
    catalog=[...new Map(catalog.map(m=>[m.id,m])).values()];renderModels();
    const found=result.some(m=>m.id===state.settings.model||m.aliases?.includes(state.settings.model));
    $('#catalog-status').textContent=`${catalog.length} Claude models loaded. ${found?'Your selected ID is listed.':'Your selected ID was not found; choose a listed model or verify its alias with Puter.'}`;
  }catch(error){$('#catalog-status').textContent=errorMessage(error);}
  finally{$('#refresh-models').disabled=false;}
}
$('#refresh-models').onclick=loadModels;
$('#model-select').onchange=e=>{state.settings.model=e.target.value;save();notify('Model updated for future replies.');};
function openSettings(){if(job)return notify('Stop the current response before changing settings.');$('#model-input').value=state.settings.model;$('#system-input').value=state.settings.system;$('#tokens-input').value=state.settings.maxTokens;$('#theme-input').value=state.settings.theme;$('#settings').showModal();}
$('#settings-open').onclick=openSettings;$('#settings-close').onclick=()=>$('#settings').close();
$('#settings-form').onsubmit=e=>{e.preventDefault();state.settings=validSettings({model:$('#model-input').value,system:$('#system-input').value,maxTokens:Number($('#tokens-input').value),theme:$('#theme-input').value});applyTheme();renderModels();save();$('#settings').close();notify('Preferences saved. They apply to future replies.');};
$('#theme-toggle').onclick=()=>{state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme();save();};
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=make('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export-chat').onclick=()=>{const c=current();if(!c?.messages.length)return notify('Start a conversation to export it.');download(markdownExport(c),c.title.replace(/[^a-z0-9_-]/gi,'-').slice(0,70)+'.md','text/markdown;charset=utf-8');};
$('#export-all').onclick=()=>download(JSON.stringify({...state,exportedAt:now()},null,2),`atelier-backup-${now().slice(0,10)}.json`,'application/json');
$('#import-all').onclick=()=>$('#import-input').click();
$('#import-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>20*1024*1024)return notify('Backup limit is 20 MB.');
  try{const imported=normalizeBackup(JSON.parse(await file.text()));if(!confirm(`Replace your current history with ${imported.chats.length} imported conversations? Export a backup first if needed.`))return;state=imported;pendingFiles=[];drafts.clear();$('#prompt').value='';renderFiles();applyTheme();save();renderModels();render();$('#settings').close();notify('Backup imported.');}catch(error){notify(error.message||'Invalid backup file.');}
};
$('#clear-all').onclick=()=>{if(!confirm('Delete all locally saved conversations? Export a backup first. This cannot be undone.'))return;state.chats=[];state.activeId=null;pendingFiles=[];drafts.clear();$('#prompt').value='';renderFiles();save();render();notify('Local conversation history cleared.');};
async function updateAuth(){
  if(!window.puter?.auth)return;
  try{if(window.puter.auth.isSignedIn()){const user=await window.puter.auth.getUser();$('#auth-label').replaceChildren(document.createTextNode(user.username||'Connected to Puter'),make('small','','Puter account connected'));$('#auth').title='Sign out of Puter';}else{$('#auth-label').replaceChildren(document.createTextNode('Connect to Puter'),make('small','','Your account powers the AI'));$('#auth').title='Sign in to Puter';}}catch{/* Signing in remains available even if profile lookup fails. */}
}
$('#auth').onclick=async()=>{
  if(!window.puter?.auth)return notify('Puter.js is not loaded. Check your connection and reload.');if(job)return notify('Stop the current response before changing accounts.');
  try{if(window.puter.auth.isSignedIn()){if(!confirm('Sign out of Puter? Local conversations will remain in this browser.'))return;await window.puter.auth.signOut();}else await window.puter.auth.signIn();await updateAuth();}catch(error){notify(errorMessage(error));}
};
function closeNav(){$('main').inert=false;document.body.classList.remove('nav-open');$('#scrim').hidden=true;$('#menu').setAttribute('aria-expanded','false');if(innerWidth<=760)$('#sidebar').inert=true;}
function openNav(){$('main').inert=true;document.body.classList.add('nav-open');$('#scrim').hidden=false;$('#menu').setAttribute('aria-expanded','true');$('#sidebar').inert=false;$('#new-chat').focus();}
$('#menu').onclick=()=>document.body.classList.contains('nav-open')?closeNav():openNav();$('#scrim').onclick=closeNav;
matchMedia('(max-width: 760px)').addEventListener('change',e=>{closeNav();$('#sidebar').inert=e.matches;});
if(innerWidth<=760)$('#sidebar').inert=true;
$('#new-chat').onclick=newChat;$('#search').oninput=renderSidebar;
$('#composer').onsubmit=e=>{e.preventDefault();send();};
$('#prompt').addEventListener('input',()=>{resizePrompt();setBusy();});
$('#prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}};
$('#stop').onclick=()=>{if(job){job.controller.abort();setBusy();announce('Stopping response.');}};
$('#jump-bottom').onclick=()=>scrollBottom(true);
$('#scroll-area').onscroll=()=>{$('#jump-bottom').hidden=nearBottom()||!current()?.messages.length;};
for(const button of document.querySelectorAll('[data-prompt]'))button.onclick=()=>{$('#prompt').value=button.dataset.prompt;resizePrompt();setBusy();$('#prompt').focus();};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();newChat();}if(e.key==='Escape'&&document.body.classList.contains('nav-open')){closeNav();$('#menu').focus();}});
window.addEventListener('beforeunload',e=>{if(job){e.preventDefault();e.returnValue='';}if(current())save();});
// The SDK is deferred and may load after this module. Do not block the interface.
window.addEventListener('load',()=>{updateAuth();if(window.puter?.ai?.listModels)loadModels();});
renderModels();render();resizePrompt();
