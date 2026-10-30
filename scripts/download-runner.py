"""OS-level per-job lease. Never signals processes or opens a Rekordbox library."""
import fcntl
from pathlib import Path
import subprocess
import sys

if sys.argv[1] in ('--account-lock', '--file-lock'):
    path = Path(sys.argv[2]) / '.admission-flock' if sys.argv[1] == '--account-lock' else Path(sys.argv[2])
    with path.open('a') as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            sys.exit(3)
        print('locked', flush=True)
        sys.stdin.read()
    sys.exit(0)

probe = sys.argv[1] == '--probe'
manifest = Path(sys.argv[2]).resolve(strict=True)
with (manifest.parent / 'worker.lock').open('a') as lock:
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(3)
    if not probe:
        # Keep the lease in both runner and worker: killing either cannot release
        # it while the other is still doing work. Children close unrelated FDs.
        script = Path(__file__).with_name('download-worker.mjs')
        result = subprocess.run([sys.argv[1], str(script), str(manifest)], pass_fds=(lock.fileno(),))
        sys.exit(result.returncode)
