const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
function setup(fetchImpl) {
  const values={name:'Test Guest',email:'test@example.com',room:'A101',checkin:'2026-12-01',checkout:'2026-12-03',adults:'2',message:'Test'};
  const fields=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,disabled:false}]));
  const button={disabled:false,textContent:'Send inquiry'},out={textContent:''};let submit,resets=0;
  const form={querySelector:()=>button,querySelectorAll:()=>Object.values(fields),reportValidity:()=>true,addEventListener:(type,fn)=>submit=fn,setAttribute(){},removeAttribute(){},reset(){resets++;}};
  const storage=new Map();
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../form.js'),'utf8'),{document:{getElementById:id=>id==='form'?form:id==='result'?out:fields[id]},crypto:webcrypto,TextEncoder,Uint8Array,AbortSignal,fetch:fetchImpl,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  return {fields,button,out,submit:()=>submit({preventDefault(){}}),resets:()=>resets};
}
test('form shows loading, prevents double clicks, preserves input and ID after failure',async()=>{
  const ids=[];let release;
  const ui=setup(async(url,options)=>{assert.equal(url,'/api/inquiries');ids.push(JSON.parse(options.body).request_id);await new Promise(resolve=>release=resolve);return {ok:false,json:async()=>({error:'Please retry.'})};});
  const first=ui.submit();await ui.submit();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.button.disabled,true);assert.equal(ui.button.textContent,'Submitting…');assert.equal(ids.length,1);
  release();await first;
  assert.equal(ui.fields.name.value,'Test Guest');assert.equal(ui.resets(),0);assert.equal(ui.out.textContent,'Please retry.');assert.equal(ui.button.disabled,false);
  const second=ui.submit();await new Promise(resolve=>setImmediate(resolve));release();await second;
  assert.equal(ids[0],ids[1]);
});
test('form clears only on matching explicit server acceptance',async()=>{
  const ui=setup(async(url,options)=>({ok:true,json:async()=>({accepted:true,request_id:JSON.parse(options.body).request_id})}));
  await ui.submit();assert.equal(ui.resets(),1);assert.match(ui.out.textContent,/not a reservation confirmation/);
});
test('invalid adult count never sends HTTP request',async()=>{
  const ui=setup(async()=>{throw Error('Must not submit');});ui.fields.adults.value='3';await ui.submit();assert.match(ui.out.textContent,/cannot accommodate/);assert.equal(ui.resets(),0);
});
