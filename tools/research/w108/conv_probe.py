import json, torch
torch.set_num_threads(4)
x=torch.ones((1,6144,512),device='cuda',dtype=torch.float16)
w=torch.ones((6144,1,4),device='cuda',dtype=torch.float16)
results=[]
for enabled in [True,False]:
    torch.backends.cudnn.enabled=enabled
    try:
        y=torch.nn.functional.conv1d(x,w,padding=3,groups=6144)
        torch.cuda.synchronize()
        assert y[0,0,10].item()==4
        results.append({'cudnn_enabled':enabled,'outcome':'Worked','value':y[0,0,10].item()})
    except Exception as error:results.append({'cudnn_enabled':enabled,'outcome':'Failed','error':str(error)})
print(json.dumps({'torch':torch.__version__,'cuda':torch.version.cuda,'cudnn_version':torch.backends.cudnn.version(),'device':torch.cuda.get_device_name(0),'results':results}))
