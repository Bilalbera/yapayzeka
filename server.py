# --- server.py ---
# pip install fastapi uvicorn anthropic httpx python-dotenv
# Run: uvicorn server:app --reload --port 8000
 
import os
import uuid
import httpx
import anthropic
 
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
 
load_dotenv()
 
app = FastAPI(title="BilalAI Backend", version="1.0.0")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
 
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
BLENDER_URL       = os.getenv("BLENDER_URL", "http://localhost:9001")
 
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
 
SYSTEM_PROMPT = """You are BilalAI, an expert Blender 3D assistant. Your only output is valid Python code
that uses Blender's bpy API. Never explain, never apologize, never add markdown fences.
Return only raw executable Python — no ```python, no ```, no comments explaining what you're doing.
 
Rules:
- Always clear the default scene before building: delete all objects with bpy.ops.object.select_all + bpy.ops.object.delete
- Use bpy.ops, bpy.data, and bpy.context correctly
- For characters: build with mesh primitives, apply modifiers, set materials with nodes
- For animations: use keyframes via obj.keyframe_insert(data_path=..., frame=...)
- Materials must use nodes: mat.use_nodes = True, then build a node tree
- Never use bpy.ops inside a loop without context overrides — use bpy.data directly where possible
- UV unwrap when applying image textures
- Set frame range: bpy.context.scene.frame_start / frame_end
- All object names must be descriptive strings
- Code must be complete and self-contained — no imports needed beyond bpy (already in scope)
 
If the request is ambiguous, build the most visually interesting interpretation.
Output only the Python script. Nothing else."""
 
 
# ── Models ────────────────────────────────────────────────────────────────────
 
class ChatMessage(BaseModel):
    role:    str   # "user" | "assistant"
    content: str
 
class ChatRequest(BaseModel):
    messages:        list[ChatMessage]
    send_to_blender: bool = True
 
class ChatResponse(BaseModel):
    reply:      str
    script:     str | None
    blender_ok: bool | None
    request_id: str | None
 
 
# ── Helpers ───────────────────────────────────────────────────────────────────
 
def extract_script(text: str) -> str:
    """Strip any accidental markdown fences the model sneaks in."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # drop opening fence
        lines = lines[1:] if lines[0].startswith("```") else lines
        # drop closing fence
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text
 
async def push_to_blender(script: str, request_id: str) -> bool:
    payload = {"script": script, "request_id": request_id}
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.post(f"{BLENDER_URL}", json=payload)
        return resp.status_code == 200
    except httpx.RequestError:
        return False
 
async def blender_health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as http:
            resp = await http.get(f"{BLENDER_URL}/health")
        return resp.status_code == 200
    except httpx.RequestError:
        return False
 
 
# ── Routes ────────────────────────────────────────────────────────────────────
 
@app.get("/health")
async def health():
    blender_up = await blender_health()
    return {"status": "ok", "blender_connected": blender_up}
 
 
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # Build message list for Anthropic
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
 
    try:
        response = client.messages.create(
            model      = "claude-sonnet-4-6",
            max_tokens = 4096,
            system     = SYSTEM_PROMPT,
            messages   = messages,
        )
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {exc}")
 
    raw_reply = response.content[0].text
    script    = extract_script(raw_reply)
 
    # Determine if this looks like bpy code
    is_script = "bpy" in script
 
    blender_ok = None
    request_id = None
 
    if is_script and req.send_to_blender:
        request_id = str(uuid.uuid4())
        blender_ok = await push_to_blender(script, request_id)
 
    # Friendly reply for the chat UI
    if is_script:
        line_count  = len(script.splitlines())
        reply_text  = f"Generated a {line_count}-line Blender script."
        if blender_ok is True:
            reply_text += " Sent to Blender — check your viewport."
        elif blender_ok is False:
            reply_text += " Blender isn't connected — copy the script and run it manually."
    else:
        reply_text = raw_reply
 
    return ChatResponse(
        reply      = reply_text,
        script     = script if is_script else None,
        blender_ok = blender_ok,
        request_id = request_id,
    )
 
 
@app.get("/blender/status")
async def blender_status():
    up = await blender_health()
    return {"connected": up, "url": BLENDER_URL}
