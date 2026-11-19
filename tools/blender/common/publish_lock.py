"""Cross-platform exclusive, non-blocking publish lock for the asset build scripts (W-063).

One implementation for every builder (objects/build_all.py, levels/build_levels.py) instead of per-script copies:
  * Windows: msvcrt.locking(LK_NBLCK) on the first byte of the lock file.
  * POSIX:   fcntl.flock(LOCK_EX | LOCK_NB).
Both locks are released by the OS when the process exits, so a crashed build never leaves a stale lock.
Raises BlockingIOError if another process holds the lock. Pure Python (no bpy), so it is unit-testable.

CLI (used by tests/unit/levels-assets/publishLock.test.ts):
    python3 publish_lock.py <lockfile> <hold-seconds>   -> prints LOCKED, holds, exits 0; exits 5 if already held
"""
import os
import sys
import time
from pathlib import Path


def acquire(lock_path):
    """Take the lock at `lock_path` (parent dirs created). Returns the open file; keep it open while publishing."""
    lock_path = Path(lock_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    f = open(lock_path, 'a+')
    try:
        if os.name == 'nt':
            import msvcrt
            f.seek(0)
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as e:
                raise BlockingIOError(str(e)) from e
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        f.close()
        raise
    return f


if __name__ == '__main__':
    try:
        held = acquire(sys.argv[1])
    except BlockingIOError:
        print('HELD', flush=True)
        sys.exit(5)
    print('LOCKED', flush=True)
    time.sleep(float(sys.argv[2]))
    held.close()
