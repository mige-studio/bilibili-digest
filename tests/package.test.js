import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=new URL('../',import.meta.url),m=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
test('安装声明只覆盖 B 站当前视频、音轨与两类可选服务',()=>{
  assert.deepEqual(m.permissions,['storage','sidePanel','offscreen','alarms','unlimitedStorage','declarativeNetRequestWithHostAccess']);
  assert.deepEqual(m.host_permissions,['https://www.bilibili.com/*','https://api.bilibili.com/*']);
  assert.deepEqual(m.optional_host_permissions,['https://api.deepseek.com/*','https://*.bilivideo.com/*','https://*.bilivideo.cn/*','https://openspeech.bytedance.com/*']);assert.equal(m.background.type,'module');
  for(const f of [m.background.service_worker,m.side_panel.default_path,m.options_ui.page,...m.content_scripts.flatMap(x=>x.js)])assert.ok(fs.existsSync(new URL(f,root)),f);
  for(const f of fs.readdirSync(new URL('src/',root)).filter(x=>x.endsWith('.js'))){const src=fs.readFileSync(new URL('src/'+f,root),'utf8');for(const [,dep]of src.matchAll(/from ['"]([^'"]+)['"]/g))assert.ok(fs.existsSync(new URL('src/'+path.normalize(dep),root)),dep);}
});
test('运行代码不包含图文识别、测试密钥或个人路径',()=>{
  const files=fs.readdirSync(new URL('src/',root)).filter(x=>/\.(?:js|mjs|html)$/.test(x));const source=files.map(f=>fs.readFileSync(new URL('src/'+f,root),'utf8')).join('\n');
  assert.ok(!/tesseract|IMAGE_FETCH|RESTORE_READING/i.test(source));assert.ok(!/\bsk-[A-Za-z0-9_-]{20,}/.test(source));assert.ok(!source.includes('/Users/'));
});
