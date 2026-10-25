// Optional browser smoke tests. Requires Playwright and a Chromium installation.
// npm install --no-save playwright
// npx playwright install chromium
// npm run test:browser
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'4173'},stdio:'ignore'});
let browser;
try{
  for(let n=0;n<50;n++){try{await fetch('http://127.0.0.1:4173');break;}catch{await delay(100);}}
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://js.puter.com/v2/',route=>route.fulfill({contentType:'text/javascript',body:`
    window.mockCalls=[];window.mockMode='success';
    window.puter={auth:{isSignedIn:()=>false,signIn:async()=>({}),signOut:async()=>{},getUser:async()=>({username:'test'})},ai:{
      listModels:async()=>[{id:'claude-test',name:'Claude Test',provider:'claude'}],
      chat:async function(messages,options){window.mockCalls.push({messages,model:options.model});
        if(window.mockMode==='error')throw {message:'model not found'};
        return (async function*(){
          const chunks=window.mockMode==='slow'?Array(50).fill('more text '):['## A useful answer\\n\\n','Hello **world**.\\n\\n','\\x60\\x60\\x60js\\nconst answer = 42;\\n\\x60\\x60\\x60\\n\\n','<img src=x onerror=alert(1)> [unsafe](javascript:alert)\\n\\n','| One | Two |\\n| --- | --- |\\n| A | B |'];
          for(const text of chunks){await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,window.mockMode==='slow'?100:25);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});if(options.signal.aborted)break;yield {type:'text',text};}
        })();
      }
    }};
  `}));
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#model-select option[value="claude-test"]').waitFor({state:'attached'});
  assert.equal(await page.locator('#model-select').inputValue(),'anthropic/claude-opus-5-5');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#prompt').fill('Explain something');await page.locator('#send').click();
  await page.locator('#stop').waitFor({state:'hidden'});
  assert.equal(await page.locator('.message.assistant strong').textContent(),'world');
  assert.equal(await page.locator('.message.assistant img').count(),0);
  assert.equal(await page.locator('.message.assistant a[href^="javascript:"]').count(),0);
  assert.equal(await page.locator('.code-block').count(),1);assert.equal(await page.locator('table').count(),1);
  await page.locator('#prompt').fill('Follow up');await page.locator('#send').click();await page.waitForFunction(()=>window.mockCalls.length===2);await page.locator('#stop').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.mockCalls[1].messages.length),4);
  await page.reload();await page.locator('.message').nth(3).waitFor();assert.equal(await page.locator('.message').count(),4);
  await page.evaluate(()=>window.mockMode='slow');await page.locator('#prompt').fill('Long answer');await page.locator('#send').click();await page.waitForTimeout(250);await page.locator('#stop').click();await page.locator('.message-state').filter({hasText:'Response stopped.'}).waitFor();
  await page.evaluate(()=>window.mockMode='error');await page.getByRole('button',{name:'Regenerate',exact:true}).last().click();await page.locator('.message-state.error').waitFor();assert.match(await page.locator('.message-state.error').textContent(),/catalog/);if(process.env.QA_DIR)await page.screenshot({path:process.env.QA_DIR+'/error.png'});
  await page.evaluate(()=>window.mockMode='success');await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('#stop').waitFor({state:'hidden'});
  await page.locator('#new-chat').click();await page.locator('#file-input').setInputFiles({name:'sample.txt',mimeType:'text/plain',buffer:Buffer.from('A file fixture')});await page.locator('#prompt').fill('Read this file');await page.locator('#send').click();await page.locator('#stop').waitFor({state:'hidden'});assert.match(await page.evaluate(()=>window.mockCalls.at(-1).messages[1].content),/A file fixture/);
  await page.locator('#settings-open').click();await page.locator('#system-input').fill('Be concise');await page.locator('#model-input').fill('claude-test');await page.locator('#theme-input').selectOption('dark');await page.getByRole('button',{name:'Save preferences'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  if(process.env.QA_DIR)await page.screenshot({path:process.env.QA_DIR+'/dark-chat.png'});
  await page.locator('#theme-toggle').click();
  if(process.env.QA_DIR)await page.screenshot({path:process.env.QA_DIR+'/light-chat.png'});
  await page.locator('#export-chat').click(); // exercises download without server secrets
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#menu').click();await page.locator('#settings-open').click();assert.equal(await page.locator('#settings').isVisible(),true);if(process.env.QA_DIR)await page.screenshot({path:process.env.QA_DIR+'/mobile-settings.png'});await page.locator('#settings-close').click();await page.keyboard.press('Escape');
  await page.locator('#menu').click();if(process.env.QA_DIR)await page.screenshot({path:process.env.QA_DIR+'/mobile-nav.png'});await page.locator('#new-chat').click();assert.equal(await page.locator('#welcome').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('Browser smoke checks passed: streaming, context, persistence, Markdown safety, stop, retry, attachments, settings, export, mobile navigation. Live Puter not called.');
}finally{await browser?.close();server.kill();}
