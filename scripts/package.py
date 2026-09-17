#!/usr/bin/env python3
"""Build an immutable, allowlisted candidate from a clean Git commit."""
from pathlib import Path
import hashlib,json,re,subprocess,zipfile
root=Path(__file__).resolve().parents[1]
def git(*args):
 return subprocess.check_output(['git',*args],cwd=root)
if git('status','--porcelain').strip():
 raise SystemExit('先提交候选源码，再从干净提交打包。')
revision=git('rev-parse','HEAD').decode().strip()
manifest=json.loads((root/'manifest.json').read_text())
version=manifest['version_name']
if not re.fullmatch(r'[0-9A-Za-z.\-]+',version):raise SystemExit('版本名无效')
files=['manifest.json','LICENSE','NOTICE.md','README.md','PRIVACY.md','CHANGELOG.md']
files += [str(p.relative_to(root)) for base in ['src','prompts','icons'] for p in (root/base).rglob('*') if p.is_file()]
files += ['docs/ACCEPTANCE.md']
contents={}
for name in sorted(files):
 data=git('show',f'{revision}:{name}')
 if b'/Users/' in data or re.search(rb'\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}',data):
  raise SystemExit('发布检查发现不应分发内容：'+name)
 contents[name]=data
for filename in [manifest['background']['service_worker'],manifest['side_panel']['default_path'],manifest['options_ui']['page']]:
 if filename not in contents:raise SystemExit('缺少运行文件：'+filename)
for script in manifest['content_scripts']:
 for name in script['js']:
  if name not in contents:raise SystemExit('缺少内容脚本：'+name)
for name in {*manifest.get('icons',{}).values(),*manifest.get('action',{}).get('default_icon',{}).values()}:
 if name not in contents:raise SystemExit('缺少图标：'+name)
for name,data in list(contents.items()):
 if name.endswith('.html'):
  for target in re.findall(r'(?:src|href)="([^"#?]+)"',data.decode()):
   if '://' in target:continue
   path=str(Path(name).parent/target)
   if path not in contents:raise SystemExit('缺少页面资源：'+path)
status='local-candidate-not-accepted'
meta={'name':'bilibili-digest','version':version,'sourceCommit':revision,'status':status,'files':{n:hashlib.sha256(d).hexdigest() for n,d in contents.items()}}
contents['BUILD.json']=(json.dumps(meta,ensure_ascii=False,indent=2)+'\n').encode()
out=root/'dist';out.mkdir(exist_ok=True)
package=out/f'bilibili-digest-v{version}.zip'
if package.exists():raise SystemExit('候选包已存在，不覆盖；修改后使用新候选编号。')
with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name,data in contents.items():
  info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
with zipfile.ZipFile(package) as z:
 if z.testzip() is not None:raise SystemExit('压缩包完整性检查失败')
digest=hashlib.sha256(package.read_bytes()).hexdigest()
(package.with_suffix('.zip.sha256')).write_text(digest+'  '+package.name+'\n')
print(json.dumps({'package':str(package),'version':version,'sourceCommit':revision,'files':len(contents),'sha256':digest,'bytes':package.stat().st_size},ensure_ascii=False,indent=2))
