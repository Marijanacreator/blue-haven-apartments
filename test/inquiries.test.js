const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createHandler, validate } = require('../api/inquiries');
const valid = () => ({ request_id: randomUUID(), guest_name: 'Test Guest', email: 'test@example.com', room_id: 'A101', check_in: '2026-12-01', check_out: '2026-12-03', adults: 2, message: '' });
const env = { SITE_ORIGIN: 'https://bluehaven.example', N8N_WEBHOOK_URL: 'https://automation.example/webhook/inquiry', N8N_WEBHOOK_SECRET: 'test-only-secret' };
async function invoke(handler, body = valid(), headers = {}, method = 'POST') {
  const req = { method, headers: { origin: env.SITE_ORIGIN, 'content-type': 'application/json', ...headers }, body, socket: { remoteAddress: '127.0.0.1' } };
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
  await handler(req,res); return res;
}
test('rejects invalid fields, unavailable rooms, noninteger adults and impossible dates', () => {
  for (const changes of [{ guest_name: ' ' }, { email: 'bad@address' }, { check_in: '2026-02-30' }, { check_out: '2026-12-01' }, { adults: 3 }, { adults: 0 }, { adults: 1.5 }, { room_id: 'B202' }, { request_id: 'bad' }, { message: 'x'.repeat(501) }]) assert.throws(() => validate({ ...valid(), ...changes }));
  assert.equal(validate(valid()).status,'New');
});
test('accepts only explicit acknowledgement and suppresses duplicate forwards', async () => {
  let calls=0;
  const data=valid();
  const handler=createHandler({ env, fetchImpl: async (url, options) => { calls++; assert.equal(url,env.N8N_WEBHOOK_URL); assert.equal(options.headers['X-Webhook-Secret'],env.N8N_WEBHOOK_SECRET); assert.equal(options.headers['Idempotency-Key'],data.request_id); assert.equal(JSON.parse(options.body).source,'website'); return {ok:true,json:async()=>({accepted:true,request_id:data.request_id})}; } });
  assert.equal((await invoke(handler,data)).body.accepted,true);
  assert.equal((await invoke(handler,data)).body.accepted,true); assert.equal(calls,1);
  assert.equal((await invoke(handler,{...data,message:'changed'})).statusCode,409);
});
test('missing configuration never reports success', async () => {
  const result=await invoke(createHandler({env:{SITE_ORIGIN:env.SITE_ORIGIN}}));
  assert.equal(result.statusCode,503); assert.equal(result.body.accepted,undefined);
});
test('upstream errors, timeout, generic 200 and mismatched acknowledgements fail', async () => {
  for (const fetchImpl of [async()=>{throw new DOMException('timeout','TimeoutError');},async()=>({ok:false,json:async()=>({})}),async()=>({ok:true,json:async()=>({message:'Workflow started'})}),async()=>({ok:true,json:async()=>({accepted:true,request_id:randomUUID()})})]) {
    assert.equal((await invoke(createHandler({env,fetchImpl}))).statusCode,502);
  }
});
test('failed attempts can retry with the same ID', async () => {
  let fail=true; const data=valid();
  const handler=createHandler({env,fetchImpl:async()=>{if(fail)throw Error();return {ok:true,json:async()=>({accepted:true,request_id:data.request_id})};}});
  assert.equal((await invoke(handler,data)).statusCode,502);fail=false;
  assert.equal((await invoke(handler,data)).statusCode,200);
});
test('method, origin, content type, body size, JSON and rate limits', async()=>{
  const handler=createHandler({env});
  assert.equal((await invoke(handler,valid(),{},'GET')).statusCode,405);
  assert.equal((await invoke(handler,valid(),{origin:'https://other.example'})).statusCode,403);
  assert.equal((await invoke(handler,valid(),{'content-type':'text/plain'})).statusCode,415);
  assert.equal((await invoke(handler,'x'.repeat(9000))).statusCode,413);
  assert.equal((await invoke(handler,'{')).statusCode,400);
  for(let i=0;i<8;i++)await invoke(handler);
  assert.equal((await invoke(handler)).statusCode,429);
});
