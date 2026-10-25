// A deliberately small, HTML-disabled Markdown renderer. No model output is
// inserted as HTML: every text value enters the DOM through textContent.
// Supports fenced code, headings, lists, tables, links, emphasis and blockquotes.
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function inline(text,parent,depth=0){
  if(depth>6){parent.append(document.createTextNode(text));return;}
  const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let pos=0;
  for(const m of text.matchAll(pattern)){
    parent.append(document.createTextNode(text.slice(pos,m.index)));
    const token=m[0];
    if(token.startsWith('`'))parent.append(el('code',token.slice(1,-1)));
    else if(token.startsWith('**')){const b=el('strong');inline(token.slice(2,-2),b,depth+1);parent.append(b);}
    else if(token.startsWith('*')){const i=el('em');inline(token.slice(1,-1),i,depth+1);parent.append(i);}
    else {const match=token.match(/^\[([^\]]+)\]\((.+)\)$/);let url;try{url=new URL(match[2]);}catch{}if(url&&['https:','http:','mailto:'].includes(url.protocol)){const a=el('a',match[1]);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}else parent.append(document.createTextNode(token));}
    pos=m.index+token.length;
  }
  parent.append(document.createTextNode(text.slice(pos)));
}
export function renderMarkdown(text){
  const root=document.createDocumentFragment();
  const lines=String(text).replace(/\r\n?/g,'\n').split('\n');let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    const fence=line.match(/^\s*(`{3,}|~{3,})\s*([^\s]*)/);
    if(fence){
      const lang=fence[2].replace(/[^\w#+.-]/g,'').slice(0,40)||'code';const code=[];i++;
      while(i<lines.length&&!new RegExp('^\\s*'+fence[1][0]+'{'+fence[1].length+',}\\s*$').test(lines[i]))code.push(lines[i++]);
      if(i<lines.length)i++;
      const block=el('div');block.className='code-block';const header=el('div');header.className='code-header';header.append(el('span',lang));const copy=el('button','Copy code');copy.type='button';copy.className='copy-code';copy.dataset.code=code.join('\n');header.append(copy);const pre=el('pre');pre.append(el('code',code.join('\n')));block.append(header,pre);root.append(block);continue;
    }
    const heading=line.match(/^(#{1,6})\s+(.+)$/);
    if(heading){const h=el('h'+Math.min(4,heading[1].length+1));inline(heading[2],h);root.append(h);i++;continue;}
    if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){root.append(el('hr'));i++;continue;}
    if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
      const split=s=>s.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const table=el('table');const thead=el('thead');const tr=el('tr');split(line).forEach(c=>{const th=el('th');inline(c,th);tr.append(th);});thead.append(tr);table.append(thead);const body=el('tbody');i+=2;
      while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){const row=el('tr');split(lines[i++]).forEach(c=>{const td=el('td');inline(c,td);row.append(td);});body.append(row);}table.append(body);const wrap=el('div');wrap.className='table-wrap';wrap.append(table);root.append(wrap);continue;
    }
    if(/^\s*>/.test(line)){const quote=el('blockquote');const parts=[];while(i<lines.length&&/^\s*>/.test(lines[i]))parts.push(lines[i++].replace(/^\s*>\s?/,''));inline(parts.join('\n'),quote);root.append(quote);continue;}
    const list=line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if(list){const ordered=Boolean(list[2]);const listNode=el(ordered?'ol':'ul');if(ordered)listNode.start=Number(list[2]);while(i<lines.length){const item=lines[i].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);if(!item||Boolean(item[2])!==ordered)break;const li=el('li');inline(item[3],li);listNode.append(li);i++;}root.append(listNode);continue;}
    const parts=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!/^\s*(?:#{1,6}\s|`{3,}|~{3,}|>|[-+*]\s|\d+\.\s)/.test(lines[i])&&!(i+1<lines.length&&lines[i].includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])))parts.push(lines[i++]);
    const p=el('p');parts.forEach((part,index)=>{if(index)p.append(el('br'));inline(part,p);});root.append(p);
  }
  return root;
}
