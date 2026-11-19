#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/rblake2320/afterlife-astra-w112
IMAGE=sha256:c5c116c732f24a640650e1e6e399112ef7c2b1e80c5fd7c13808b10a579646e6
test "$(cat "$ROOT/evidence/download.exit")" = 0
test -f "$ROOT/model-317dd35f/download-receipt.json"
exec 9>/home/rblake2320/afterlife-astra-w108/gpu.lock
flock -n 9 || { echo 'Spark1 Astra GPU lane occupied'; exit 3; }
if ! docker network inspect astra-w112 >/dev/null 2>&1; then
  docker network create --internal --label owner=astra-w112 astra-w112
fi
test "$(docker network inspect -f '{{index .Labels "owner"}}' astra-w112)" = astra-w112
test "$(docker network inspect -f '{{.Internal}}' astra-w112)" = true
docker run --rm --init --name astra-w112-nano-317dd35f --label owner=astra-w112 \
  --network astra-w112 --network-alias nano --gpus all --cpus 8 --memory 48g --shm-size 2g \
  --security-opt no-new-privileges --cap-drop ALL \
  -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e VLLM_WORKER_MULTIPROC_METHOD=spawn \
  -v "$ROOT/model-317dd35f:/model:ro" \
  --entrypoint python3 "$IMAGE" -m vllm.entrypoints.openai.api_server \
  --model /model --served-model-name NorthCUA-Nano --host 0.0.0.0 --port 8000 \
  --dtype bfloat16 --max-model-len 32768 --max-num-seqs 1 --gpu-memory-utilization 0.35 \
  --enforce-eager --enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser qwen3 \
  --limit-mm-per-prompt '{"image":3,"video":0}' --mm-processor-cache-gb 0 \
  --no-enable-log-requests
