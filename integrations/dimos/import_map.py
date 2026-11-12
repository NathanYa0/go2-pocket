"""Copy a verified DimOS map into Pocket's local saved-map library."""
import json
from pathlib import Path
import shutil
import sys
import uuid

from dimos.navigation.go2.loop_closure.premap import Premap
from bridge import RUNTIME, preview, save_preview

source = Path(sys.argv[1]).resolve()
map_data = Premap.load(source)
if not len(map_data):
    raise SystemExit("The file contains no map keyframes.")
run_id = "imported-" + uuid.uuid4().hex[:12]
RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
shutil.copy2(source, RUNTIME / (run_id + ".map.db"))
save_preview(run_id, preview(map_data.cloud()))
(RUNTIME / (run_id + ".meta.json")).write_text(json.dumps({"validated": True, "keyframes": len(map_data)}))
print(f"Imported {len(map_data)} keyframes as {run_id}. Open Maps to view it.")
