"""Verify the portable packet's actual bytes; historical report status is not upgraded."""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--git',action='store_true',help='Also ask Git to recompute raw blob IDs; no index/ref change.')
args=parser.parse_args()
root=Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json.txt').read_text(encoding='utf-8'))
assert 0<len(manifest['files'])<=5000
errors=[]
for row in manifest['files']:
    relative=Path(row['path'])
    if relative.is_absolute()or '..'in relative.parts:
        errors.append({'path':row['path'],'error':'unsafe manifest path'});continue
    candidate=root/relative
    if not candidate.is_file()or any(p.is_symlink()for p in [candidate,*candidate.parents]if p.is_relative_to(root)):
        errors.append({'path':row['path'],'error':'missing or linked payload'});continue
    data=candidate.read_bytes()
    digest=hashlib.sha256(data).hexdigest()
    git_blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if len(data)!=row['bytes']or digest!=row['sha256']or git_blob!=row['rawGitBlobSha1']:
        errors.append({'path':row['path'],'error':'raw payload mismatch'})
    if args.git:
        result=subprocess.run(['git','hash-object','--no-filters','--stdin'],input=data,capture_output=True,timeout=15)
        if result.returncode or result.stdout.decode().strip()!=git_blob:
            errors.append({'path':row['path'],'error':'Git raw blob mismatch'})
mapping=json.loads((root/'copy-map.json.txt').read_text(encoding='utf-8'))['rawCopies']
indexed={row['path']:row for row in manifest['files']}
for row in mapping:
    target=indexed.get(row['destination'])
    if not target or any(target[k]!=row[k]for k in ['bytes','sha256','rawGitBlobSha1']):
        errors.append({'path':row['path'],'error':'raw-copy map does not bind its portable payload'})
print(json.dumps({'status':'PASS'if not errors else'FAIL','payloadFiles':len(manifest['files']),'mappedOriginals':len(mapping),'gitRawBlobCheck':args.git,'errors':errors,'scope':'Portable raw bytes only. Omitted operator artifacts, historical test outcomes, current source behavior and deployment are not certified by this verifier.'}))
sys.exit(bool(errors))
