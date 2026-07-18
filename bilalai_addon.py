# --- bilalai_addon.py ---
# Install via Blender > Edit > Preferences > Add-ons > Install
# Then enable "BilalAI Connector" and click "Start BilalAI Server"
 
bl_info = {
    "name":        "BilalAI Connector",
    "author":      "BilalAI",
    "version":     (1, 0, 0),
    "blender":     (3, 6, 0),
    "location":    "View3D > Sidebar > BilalAI",
    "description": "Connects Blender to BilalAI for AI-driven scene generation",
    "category":    "3D View",
}
 
import bpy
import json
import queue
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
 
# ── Shared state ──────────────────────────────────────────────────────────────
 
_script_queue: queue.Queue = queue.Queue()
_result_store: dict        = {}   # request_id → {"status", "error"}
_server_instance: HTTPServer | None = None
_server_thread:   threading.Thread | None = None
 
PORT = 9001
 
 
# ── HTTP handler ──────────────────────────────────────────────────────────────
 
class BilalAIHandler(BaseHTTPRequestHandler):
 
    def do_OPTIONS(self) -> None:
        self._cors()
        self.send_response(204)
        self.end_headers()
 
    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length)
            body   = json.loads(raw)
        except (ValueError, json.JSONDecodeError) as exc:
            self._respond(400, {"error": f"Bad request: {exc}"})
            return
 
        script     = body.get("script", "").strip()
        request_id = body.get("request_id", "unknown")
 
        if not script:
            self._respond(400, {"error": "Empty script"})
            return
 
        _script_queue.put({"script": script, "request_id": request_id})
        self._respond(200, {"status": "queued", "request_id": request_id})
 
    def do_GET(self) -> None:
        """Health check."""
        if self.path == "/health":
            self._respond(200, {"status": "ok", "blender": True})
        else:
            self._respond(404, {"error": "Not found"})
 
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
 
    def _respond(self, code: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
 
    def log_message(self, *_):
        pass  # silence default stderr logging
 
 
# ── Modal operator — executes scripts on Blender's main thread ────────────────
 
class BILALAI_OT_Server(bpy.types.Operator):
    bl_idname = "bilalai.server"
    bl_label  = "BilalAI Server"
 
    _timer = None
 
    def modal(self, context: bpy.types.Context, event: bpy.types.Event):
        global _server_instance
 
if _server_instance is None:
    return self.cancel(context)
 
        if event.type != "TIMER":
            return {"PASS_THROUGH"}
 
        # Drain the queue — all bpy calls happen here, on the main thread
        processed = 0
        while not _script_queue.empty() and processed < 5:
            item = _script_queue.get_nowait()
            self._execute(item["script"], item["request_id"])
            processed += 1
 
        return {"PASS_THROUGH"}
 
    def _execute(self, script: str, request_id: str) -> None:
        try:
            exec(compile(script, "<bilalai>", "exec"), {"bpy": bpy, "__name__": "__bilalai__"})
            _result_store[request_id] = {"status": "ok"}
            print(f"[BilalAI] ✓ {request_id}")
        except Exception:
            err = traceback.format_exc()
            _result_store[request_id] = {"status": "error", "error": err}
            print(f"[BilalAI] ✗ {request_id}\n{err}")
 
    def execute(self, context: bpy.types.Context):
        global _server_instance, _server_thread
 
        if _server_instance is not None:
            self.report({"WARNING"}, "BilalAI server already running.")
            return {"CANCELLED"}
 
        try:
            _server_instance = HTTPServer(("", PORT), BilalAIHandler)
        except OSError as exc:
            self.report({"ERROR"}, f"Cannot bind port {PORT}: {exc}")
            return {"CANCELLED"}
 
        _server_thread = threading.Thread(
            target=_server_instance.serve_forever,
            daemon=True,
        )
        _server_thread.start()
 
        wm = context.window_manager
        self._timer = wm.event_timer_add(0.1, window=context.window)
        wm.modal_handler_add(self)
 
        self.report({"INFO"}, f"BilalAI server listening on port {PORT}")
        return {"RUNNING_MODAL"}
 
    def cancel(self, context: bpy.types.Context):
        global _server_instance, _server_thread
 
        if self._timer:
            context.window_manager.event_timer_remove(self._timer)
            self._timer = None
 
        if _server_instance:
            _server_instance.shutdown()
            _server_instance = None
 
        self.report({"INFO"}, "BilalAI server stopped.")
        return {"CANCELLED"}
 
 
class BILALAI_OT_Stop(bpy.types.Operator):
    bl_idname = "bilalai.stop"
    bl_label  = "Stop BilalAI Server"
 
    def execute(self, context):
        global _server_instance
        if _server_instance:
            _server_instance.shutdown()
            _server_instance = None
            self.report({"INFO"}, "BilalAI server stopped.")
        else:
            self.report({"WARNING"}, "Server was not running.")
        return {"FINISHED"}
 
 
# ── Sidebar panel ─────────────────────────────────────────────────────────────
 
class BILALAI_PT_Panel(bpy.types.Panel):
    bl_label      = "BilalAI"
    bl_idname     = "BILALAI_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category   = "BilalAI"
 
    def draw(self, context):
        global _server_instance
        layout = self.layout
        running = _server_instance is not None
 
        status = layout.box()
        row    = status.row()
        row.label(
            text=f"● Server: {'Running on :' + str(PORT) if running else 'Stopped'}",
            icon="RADIOBUT_ON" if running else "RADIOBUT_OFF",
        )
 
        if not running:
            layout.operator("bilalai.server",  text="Start BilalAI Server", icon="PLAY")
        else:
            layout.operator("bilalai.stop",    text="Stop Server",          icon="SNAP_FACE")
 
        layout.separator()
        layout.label(text=f"Queue depth: {_script_queue.qsize()}")
 
 
# ── Registration ──────────────────────────────────────────────────────────────
 
_classes = [
    BILALAI_OT_Server,
    BILALAI_OT_Stop,
    BILALAI_PT_Panel,
]
 
def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
 
def unregister():
    global _server_instance
    if _server_instance:
        _server_instance.shutdown()
        _server_instance = None
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
 
if __name__ == "__main__":
    register()
 
