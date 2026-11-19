"""Constrain the official generated configuration to the local Nano endpoint."""
from pathlib import Path
import os
import yaml
p=Path('/out/config')
app=yaml.safe_load((p/'app.example.yaml').read_text())
app['artifacts']['root_dir']='/out/artifacts'
app['desktop']['coordinate_policy']={'input_space':'normalized_1000','clamp_to_bounds':True}
app['evaluation']['enabled']=False
app['execution']['max_agent_iterations_per_round']=int(os.environ.get('W112_MAX_STEPS','6'))
app['prompt']['screenshot_window_images']=2
app['prompt']['history_window_rounds']=8
(p/'app.example.yaml').write_text(yaml.safe_dump(app),encoding='utf-8')
for name in ['agent.example.yaml','agent.web.example.yaml']:
    path=p/name
    cfg=yaml.safe_load(path.read_text())
    cfg['llm_config'].update(max_tokens=2048,max_context_tokens=32768,max_retries=0,timeout=240,temperature=0.7,top_p=0.95)
    path.write_text(yaml.safe_dump(cfg),encoding='utf-8')
