"""
Election Night Results - Folder Monitor Server Script
Monitors the 'Results/' folder for new or modified CSV files and automatically re-compiles data.js.
"""

import os
import sys
import time
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(BASE_DIR, 'Results')
CONVERT_SCRIPT = os.path.join(BASE_DIR, 'convert_data.py')

def get_folder_snapshot(folder_path):
    """Returns a dictionary mapping normalized relative CSV paths to (mtime, ctime, size) tuples."""
    snapshot = {}
    if os.path.exists(folder_path):
        for root, _, files in os.walk(folder_path):
            for fname in files:
                if fname.upper().endswith('.CSV'):
                    fpath = os.path.join(root, fname)
                    rel_path = os.path.relpath(fpath, folder_path).upper()
                    try:
                        stat = os.stat(fpath)
                        snapshot[rel_path] = (stat.st_mtime, stat.st_ctime, stat.st_size)
                    except OSError:
                        pass
    return snapshot

def run_conversion():
    """Triggers convert_data.py execution."""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n[{timestamp}] [MONITOR] Change detected in Results/. Triggering convert_data.py...", flush=True)
    try:
        result = subprocess.run([sys.executable, CONVERT_SCRIPT], capture_output=True, text=True, cwd=BASE_DIR)
        if result.stdout:
            print(result.stdout, flush=True)
        if result.stderr:
            print(f"[{timestamp}] [WARNING/STDERR]:\n{result.stderr}", flush=True)
        if result.returncode == 0:
            print(f"[{timestamp}] [MONITOR] Conversion & Verification SUCCESSFUL.", flush=True)
        else:
            print(f"[{timestamp}] [ERROR] Conversion exited with code {result.returncode}.", flush=True)
    except Exception as e:
        print(f"[{timestamp}] [ERROR] Failed to run convert_data.py: {e}", flush=True)

def monitor_loop(poll_interval=2):
    """Continuously monitors Results/ directory for file changes."""
    print("=" * 60)
    print(" ELECTION NIGHT RESULTS - AUTOMATIC FOLDER MONITOR SERVER")
    print(f" Monitoring Folder: {RESULTS_DIR}")
    print(f" Converter Script:  {CONVERT_SCRIPT}")
    print(" Press Ctrl+C to stop the monitor server.")
    print("=" * 60)

    if not os.path.exists(RESULTS_DIR):
        os.makedirs(RESULTS_DIR, exist_ok=True)

    # Initial snapshot
    last_snapshot = get_folder_snapshot(RESULTS_DIR)
    print(f"[MONITOR] Found {len(last_snapshot)} initial CSV file(s) in Results/.")
    
    # Run initial conversion on start
    run_conversion()

    while True:
        try:
            time.sleep(poll_interval)
            current_snapshot = get_folder_snapshot(RESULTS_DIR)

            # Check if files were added, deleted, or updated
            if current_snapshot != last_snapshot:
                added = set(current_snapshot.keys()) - set(last_snapshot.keys())
                removed = set(last_snapshot.keys()) - set(current_snapshot.keys())
                modified = {k for k in current_snapshot if k in last_snapshot and current_snapshot[k] != last_snapshot[k]}

                if added:
                    print(f"[MONITOR] New CSV file(s) added: {', '.join(added)}", flush=True)
                if removed:
                    print(f"[MONITOR] CSV file(s) removed: {', '.join(removed)}", flush=True)
                if modified:
                    print(f"[MONITOR] CSV file(s) modified: {', '.join(modified)}", flush=True)

                time.sleep(0.5) # Brief pause for file write stabilization
                run_conversion()
                last_snapshot = current_snapshot

        except KeyboardInterrupt:
            print("\n[MONITOR] Server monitor stopped by user.", flush=True)
            sys.exit(0)
        except Exception as e:
            print(f"[MONITOR ERROR] {e}", flush=True)
            time.sleep(poll_interval)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--once':
        run_conversion()
    else:
        monitor_loop()
