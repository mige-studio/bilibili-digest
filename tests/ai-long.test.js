import test from 'node:test';import assert from 'node:assert/strict';import {requestAiCompletion,parseLooseJson} from '../src/ai.js';
test('长稿完整传递到最后一句，沿用8192输出及关闭推理的母版请求',async()=>{
 const original=globalThis.fetch;const transcript=Array.from({length:10000},(_,i)=>'['+i+':00] sourceIndex='+i+' 模拟原句 '+i).join('\n');
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.messages[1].content,transcript);assert.equal(body.max_tokens,8192);assert.equal(body.thinking.type,'disabled');return new Response(JSON.stringify({choices:[{message:{content:'{"chapters":[],"keyQuotes":[]}'}}]}));};
 try{const r=await requestAiCompletion({settings:{apiKey:'fake-for-test',model:'test'},maxTokens:8192,messages:[{role:'system',content:'test'},{role:'user',content:transcript}],responseFormat:{type:'json_object'}});assert.deepEqual(parseLooseJson(r.text),{chapters:[],keyQuotes:[]});}finally{globalThis.fetch=original;}
});
test('超大或错误服务响应不能成为已保存概览；容忍模型JSON围栏及尾逗号',async()=>{
 assert.deepEqual(parseLooseJson('```json\n{"chapters":[],}\n```'),{chapters:[]});const original=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response('x'.repeat(2*1024*1024+1));await assert.rejects(requestAiCompletion({settings:{apiKey:'fake',model:'test'},messages:[],maxTokens:8192}),/过大/);globalThis.fetch=async()=>new Response('{}',{status:429});await assert.rejects(requestAiCompletion({settings:{apiKey:'fake',model:'test'},messages:[],maxTokens:8192}),/429/);}finally{globalThis.fetch=original;}
});
