import sys
import os
import re
from datetime import datetime, timedelta

cutoff = datetime.now() - timedelta(days=7)

for log_path in sys.argv[1:]:
    if not os.path.exists(log_path):
        continue
    with open(log_path, "r") as f:
        lines = f.readlines()

    has_markers = False
    keep_from = None
    for i, line in enumerate(lines):
        match = re.search(r"=== Run started: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ===", line)
        if match:
            has_markers = True
            ts = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S")
            if ts >= cutoff:
                keep_from = i
                break

    if has_markers and keep_from is None:
        open(log_path, "w").close()
    elif keep_from is not None and keep_from > 0:
        with open(log_path, "w") as f:
            f.writelines(lines[keep_from:])
