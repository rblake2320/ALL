"""Download only pinned public model files into an isolated directory; verify upstream digests."""
import concurrent.futures, hashlib, json, pathlib, sys, time, urllib.request

arm = json.loads(pathlib.Path(__file__).with_name('arms.json').read_text(encoding='utf-8'))[sys.argv[2] if len(sys.argv)>2 else 'nano']
REPO, REV = arm['repo'], arm['revision']
destination = pathlib.Path(sys.argv[1]).resolve()
destination.mkdir(parents=True, exist_ok=True)
def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'Afterlife-W108/1.0'}), timeout=90)
with request(f'https://huggingface.co/api/models/{REPO}/revision/{REV}?blobs=true') as response:
    metadata = json.load(response)
assert metadata['sha'] == REV
(destination/'upstream-metadata.json').write_text(json.dumps(metadata, indent=2))
names = {'LICENSE','NOTICE','README.md','checksums.sha256','chat_template.jinja','config.json','generation_config.json','tokenizer.json','tokenizer_config.json','model.safetensors.index.json','preprocessor_config.json','processor_config.json','video_preprocessor_config.json'}
files = [f for f in metadata['siblings'] if f['rfilename'] in names or (f['rfilename'].startswith('model-') and f['rfilename'].endswith('.safetensors'))]
def verify(file, spec):
    size=file.stat().st_size
    digest=hashlib.sha256();blob=hashlib.sha1(f'blob {size}\0'.encode())
    with file.open('rb') as stream:
        for block in iter(lambda:stream.read(8*1024*1024), b''):digest.update(block);blob.update(block)
    expected=spec.get('lfs',{}).get('sha256')
    if expected: assert digest.hexdigest()==expected, f'digest mismatch {file.name}'
    elif spec.get('blobId'):assert blob.hexdigest()==spec['blobId'], f'Git blob mismatch {file.name}'
    else:raise RuntimeError(f'No upstream digest for {file.name}')
    assert size==spec['size']
    return {'file':file.name,'bytes':size,'sha256':digest.hexdigest(),'upstream_digest_verified':True}
def download(spec):
    name=spec['rfilename'];assert pathlib.Path(name).name==name
    final=destination/name
    if final.exists():return verify(final,spec)
    partial=destination/(name+'.part')
    for attempt in range(3):
        try:
            with request(f'https://huggingface.co/{REPO}/resolve/{REV}/{name}?download=true') as response,partial.open('wb') as output:
                while True:
                    chunk=response.read(8*1024*1024)
                    if not chunk:break
                    output.write(chunk)
            receipt=verify(partial,spec);partial.replace(final);receipt['file']=name
            print(json.dumps(receipt),flush=True);return receipt
        except Exception:
            if attempt==2:raise
            time.sleep(2)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    receipts=list(pool.map(download,files))
(destination/'download-receipt.json').write_text(json.dumps({**arm,'files':receipts,'completed_at':time.time()},indent=2))
print('DOWNLOAD VERIFIED',flush=True)
