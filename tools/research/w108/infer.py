"""One sequential local GPU batch. Output is inert text, never executed here."""
import hashlib,json,pathlib,time,traceback
import torch,transformers
from transformers import AutoTokenizer, AutoModelForImageTextToText, StoppingCriteria, StoppingCriteriaList

torch.set_num_threads(8)
# Retained conv_probe.py reproduces this container's cuDNN GET failure and tests ATen CUDA.
torch.backends.cudnn.enabled=False
class Progress(StoppingCriteria):
    def __init__(self,prop,start,input_length):self.prop=prop;self.start=start;self.input_length=input_length;self.last=start
    def __call__(self,input_ids,scores,**kwargs):
        now=time.time()
        if now-self.last>20:
            print(json.dumps({'event':'progress','prop':self.prop,'tokens':input_ids.shape[1]-self.input_length,'seconds':now-self.start}),flush=True);self.last=now
        return now-self.start>300

output=pathlib.Path('/output');output.mkdir(exist_ok=True)
spec=json.loads(pathlib.Path('/work/props.json').read_text())
model_metadata=json.loads(pathlib.Path('/model/upstream-metadata.json').read_text())
system='You create reusable stylized Three.js game props. Return only JavaScript code defining function buildAsset(THREE) that returns one THREE.Group. Do not import anything. Do not create a renderer, lights, camera, HTML, controls, scene, ground plane, text, external resources or animation. Use only core Three.js geometry and MeshStandardMaterial. No fetch, DOM, filesystem, eval or random numbers. Named meshes, meters, Y up, centered X/Z, lowest point at Y=0. Prefer smooth low-segment geometry rather than voxels. Use geometry vertex colors or material colors; no image textures. Name the main recolorable material Paint. Art direction: cosy macabre diorama, soft bevels, chunky proportions, muted warm colors. Suggested palette: plum #1d1726, slate #2b2f3a, moss #6f8f5e, bone #e8e0c8, rust #a5532f, wine #6e2a35, candle #ffb35a, cryo #7fe0ff. Roughness .55-.9, metallic only for metal. The calling harness handles preview and GLB export.'
started=time.time();assert torch.cuda.is_available()
print(json.dumps({'event':'loading','script_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'props_sha256':hashlib.sha256(pathlib.Path('/work/props.json').read_bytes()).hexdigest(),'torch':torch.__version__,'transformers':transformers.__version__}),flush=True)
tokenizer=AutoTokenizer.from_pretrained('/model',local_files_only=True,trust_remote_code=False)
model=AutoModelForImageTextToText.from_pretrained('/model',local_files_only=True,trust_remote_code=False,dtype=torch.float16,attn_implementation='sdpa').to('cuda')
loaded=time.time();print(json.dumps({'event':'loaded','seconds':loaded-started,'torch':torch.__version__,'transformers':transformers.__version__,'device':torch.cuda.get_device_name(0)}),flush=True)
for index,prop in enumerate(spec['props']):
    path=output/(prop['id']+'.json')
    if path.exists():raise RuntimeError(f'Refusing to overwrite {path}')
    seed=10800+index;torch.manual_seed(seed)
    prompt=f"Create {prop['name']}. {prop['description']} Fit wholly inside width,height,depth {prop['size']} meters, including every decoration. At most {prop['triangles']} triangles and {prop['materials']} distinct materials. Use radialSegments 8 or 12 for small curves. Make every component meaningful; no placeholder boxes for the main silhouette. Build enough detail to look finished, but respect the budget. Return the complete buildAsset function."
    messages=[{'role':'system','content':system},{'role':'user','content':prompt}]
    text=tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
    inputs=tokenizer(text,return_tensors='pt').to('cuda');begin=time.time()
    try:
        with torch.inference_mode():generated=model.generate(**inputs,max_new_tokens=5000,do_sample=True,temperature=.7,top_p=.95,top_k=20,repetition_penalty=1.0,use_cache=True,stopping_criteria=StoppingCriteriaList([Progress(prop['id'],begin,inputs['input_ids'].shape[1])]))
        torch.cuda.synchronize();tokens=generated[0,inputs['input_ids'].shape[1]:]
        response=tokenizer.decode(tokens,skip_special_tokens=True)
        eos=model.generation_config.eos_token_id;eos=eos if isinstance(eos,list) else [eos]
        receipt={'prop':prop,'attempt':1,'seed':seed,'messages':messages,'seconds':time.time()-begin,'output_tokens':len(tokens),'token_limit_reached':len(tokens)>=5000,'ended_eos':tokens[-1].item() in eos,'cudnn_enabled':False,'response':response,'model_revision':model_metadata['sha'],'model_repo':model_metadata['id'],'torch':torch.__version__,'transformers':transformers.__version__,'device':torch.cuda.get_device_name(0),'max_memory_bytes':torch.cuda.max_memory_allocated(),'outcome':'Generated text'}
        path.write_text(json.dumps(receipt,indent=2));print(json.dumps({k:receipt[k] for k in ['outcome','seconds','output_tokens','token_limit_reached']}|{'prop':prop['id']}),flush=True)
    except Exception as error:
        path.write_text(json.dumps({'prop':prop,'outcome':'Failed','error':str(error),'traceback':traceback.format_exc()},indent=2));raise
print(json.dumps({'event':'batch_complete','seconds':time.time()-started}),flush=True)
