#!/usr/bin/env bash
# Run on Spark1 after placing these files in ~/afterlife-astra-w108/tools/.
set -euo pipefail
run_id="${1:?supply a new run name, e.g. native-smoke}"
[[ "$run_id" =~ ^[a-z0-9-]+$ ]] || exit 2
job_root="$HOME/afterlife-astra-w108"
arm="glb"
case "$arm" in scene) model_dir=model-4b9f05f;; glb) model_dir=model-8f32a199;; *) exit 2;; esac
exec 9>"$job_root/gpu.lock"
flock -n 9 || { echo "Another Astra GPU batch holds the lock"; exit 3; }
output="$job_root/$run_id"
[[ ! -e "$output" ]] || { echo 'Refusing to overwrite an earlier run'; exit 2; }
mkdir -p "$output"
image='sha256:c5c116c732f24a640650e1e6e399112ef7c2b1e80c5fd7c13808b10a579646e6'
name="astra-w108-qwen-$run_id"
stop_owned() {
  owner="$(docker inspect --format '{{index .Config.Labels "afterlife.owner"}}' "$name" 2>/dev/null || true)"
  [[ "$owner" != astra ]] || docker stop "$name" >/dev/null
}
trap stop_owned INT TERM
set +e
timeout --signal=TERM --kill-after=15s 1800 docker run --rm --pull=never --name "$name" --label afterlife.owner=astra \
  --gpus all --network none --read-only --tmpfs /tmp:rw,size=1g \
  --memory 32g --cpus 8 --shm-size 1g --pids-limit 256 --cap-drop ALL \
  --security-opt no-new-privileges --user "$(id -u):$(id -g)" \
  -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e HOME=/tmp -e XDG_CACHE_HOME=/tmp/cache \
  -v "$job_root/$model_dir:/model:ro" -v "$job_root/tools:/work:ro" \
  -v "$output:/output" --entrypoint python "$image" /work/infer_native.py \
  > "$job_root/$run_id.log" 2>&1
status=$?
stop_owned
set -e
printf '%s\n' "$status" > "$job_root/$run_id.exit"
tail -15 "$job_root/$run_id.log"
exit "$status"
