// Bounded, UTF-8-safe host-path scrubbing before logs are persisted or tool errors reach a client.
import { StringDecoder } from 'node:string_decoder';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function rules(roots) {
  const seen=new Set(),result=[];
  for(const {path,label} of roots) {
    if(typeof path!=='string')continue;
    const root=path.replace(/[\\/]+$/,'');
    if(root.length<3 || /^[a-z]:$/i.test(root))continue;
    const windows=/^[a-z]:|^\\\\/i.test(root);
    for(const form of new Set([root,root.replaceAll('\\','/'),root.replaceAll('/','\\')])) {
      for(const value of new Set([form,JSON.stringify(form).slice(1,-1),encodeURI(form),encodeURIComponent(form)])) {
        const key=windows?value.toLowerCase():value;
        if(seen.has(key))continue;seen.add(key);
        result.push({value,label,windows});
      }
    }
  }
  return result.sort((a,b)=>b.value.length-a.value.length);
}
export function pathRedactor(roots) {
  const entries=rules(roots);
  // Separate flags keep POSIX paths case-sensitive, Windows drive/UNC paths insensitive.
  const patterns=entries.map(e=>({...e,re:new RegExp(escape(e.value),e.windows?'gi':'g')}));
  const prefix=(text,limit)=>{
    const spans=[];
    for(const {re,label} of patterns) {re.lastIndex=0;let m;while((m=re.exec(text)))if(m.index<limit)spans.push({start:m.index,end:m.index+m[0].length,label});}
    // First occurrence wins; at an equal start the longest root wins. Never emit a partial root.
    spans.sort((a,b)=>a.start-b.start||b.end-a.end);
    let cursor=0,output='';
    for(const {start,end,label} of spans) {
      if(start<cursor)continue;
      output+=text.slice(cursor,start)+`[${label}]`;cursor=end;
    }
    const through=Math.max(cursor,limit);output+=text.slice(cursor,through);
    return {output,rest:text.slice(through)};
  };
  const redact=value=>{const text=String(value);return prefix(text,text.length).output;};
  return {redact,maxLength:Math.max(1,...entries.map(e=>e.value.length)),prefix};
}
export function pathScrubber(roots,emit) {
  const {maxLength,prefix}=pathRedactor(roots),decoder=new StringDecoder('utf8');
  let pending='',ended=false;
  const flush=final=>{
    const limit=final?pending.length:Math.max(0,pending.length-maxLength+1);
    const result=prefix(pending,limit);if(result.output)emit(result.output);pending=result.rest;
  };
  return {
    write(chunk){if(ended)throw Error('Log scrubber ended');pending+=decoder.write(Buffer.from(chunk));flush(false);},
    end(){if(ended)return;ended=true;pending+=decoder.end();flush(true);},
  };
}
export function publicCreatorError(error,roots) {
  // Native filesystem errors may name paths outside all configured roots; expose the stable errno only.
  if(error && typeof error.code==='string' && /^E[A-Z0-9]+$/.test(error.code))return `Creator filesystem operation failed (${error.code}).`;
  return pathRedactor(roots).redact(error instanceof Error?error.message:'Creator tool failed');
}
