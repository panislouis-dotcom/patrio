from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from api.process_db import (
    get_templates, get_template, create_template, update_template, delete_template,
    get_template_nodes, get_node, create_node, update_node, delete_node,
    get_instances, get_instance, create_instance, update_instance,
    upsert_node_state, get_instance_states,
    get_node_files, create_node_file, delete_node_file,
    get_node_comments, create_node_comment, delete_node_comment,
    get_instance_files, create_instance_file, delete_instance_file,
    _template_references,
)
from api.gantt import compute_gantt

router = APIRouter()


class TemplateCreate(BaseModel):
    name: str
    description: str = ""

class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class NodeCreate(BaseModel):
    name: str
    description: str = ""
    sortOrder: int = 0
    parentId: Optional[int] = None
    dependsOnId: Optional[int] = None
    durationDays: Optional[int] = None
    sourceTemplateId: Optional[int] = None

class NodeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sortOrder: Optional[int] = None
    dependsOnId: Optional[int] = None
    durationDays: Optional[int] = None
    sourceTemplateId: Optional[int] = None

class InstanceCreate(BaseModel):
    name: str
    startDate: str
    templateId: Optional[int] = None
    projectId: Optional[int] = None
    ownerId: Optional[int] = None
    frequencyDays: Optional[int] = None
    dueDate: Optional[str] = None
    notes: str = ""
    status: str = "active"
    originInstanceId: Optional[int] = None

class InstanceUpdate(BaseModel):
    name: Optional[str] = None
    startDate: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    projectId: Optional[int] = None
    ownerId: Optional[int] = None
    dueDate: Optional[str] = None
    frequencyDays: Optional[int] = None
    durationLockedAt: Optional[str] = None

class NodeStateUpdate(BaseModel):
    status: Optional[str] = None
    assigneeId: Optional[int] = None
    actualStart: Optional[str] = None
    actualEnd: Optional[str] = None
    notes: Optional[str] = None
    durationOverrideDays: Optional[int] = None

class CommentCreate(BaseModel):
    body: str
    author: str = ""


# ─── Templates ────────────────────────────────────

@router.get("/api/process/templates")
def list_templates():
    return get_templates()

@router.post("/api/process/templates", status_code=201)
def post_template(body: TemplateCreate):
    return create_template(body.model_dump())

@router.patch("/api/process/templates/{tid}")
def patch_template(tid: int, body: TemplateUpdate):
    updated = update_template(tid, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return updated

@router.delete("/api/process/templates/{tid}", status_code=204)
def delete_template_route(tid: int):
    if get_template(tid) is None:
        raise HTTPException(status_code=404, detail="Template not found")
    delete_template(tid)

# ─── Nodes ────────────────────────────────────────

@router.get("/api/process/templates/{tid}/nodes")
def list_template_nodes(tid: int):
    return get_template_nodes(tid)

@router.post("/api/process/templates/{tid}/nodes", status_code=201)
def post_node(tid: int, body: NodeCreate):
    data = body.model_dump()
    src = data.get('sourceTemplateId')
    if src is not None:
        # Validate source template exists
        if get_template(src) is None:
            raise HTTPException(status_code=404, detail="Source template not found")
        # Validate no cycle: current template must not be reachable from source
        if tid in _template_references(src):
            raise HTTPException(status_code=400, detail="Cycle detected: source template references this template")
    data["templateId"] = tid
    return create_node(data)

@router.patch("/api/process/nodes/{nid}")
def patch_node(nid: int, body: NodeUpdate):
    updated = update_node(nid, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return updated

@router.delete("/api/process/nodes/{nid}", status_code=204)
def delete_node_route(nid: int):
    if get_node(nid) is None:
        raise HTTPException(status_code=404, detail="Node not found")
    delete_node(nid)

@router.get("/api/process/templates/{tid}/preview")
def get_template_preview(tid: int):
    template = get_template(tid)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    nodes = get_template_nodes(tid)
    nodes = compute_gantt(nodes)
    return {"template": template, "nodes": nodes}

# ─── Instances ────────────────────────────────────

@router.get("/api/process/instances")
def list_instances(project_id: Optional[int] = None):
    return get_instances(project_id=project_id)

@router.post("/api/process/instances", status_code=201)
def post_instance(body: InstanceCreate):
    return create_instance(body.model_dump())

@router.patch("/api/process/instances/{iid}")
def patch_instance(iid: int, body: InstanceUpdate):
    from datetime import datetime
    data = body.model_dump(exclude_unset=True)

    # Record completion time for periodic auto-scheduling
    if data.get("status") == "completed":
        data["completedAt"] = datetime.utcnow().strftime("%Y-%m-%d")

    updated = update_instance(iid, data)
    if updated is None:
        raise HTTPException(status_code=404, detail="Instance not found")

    return {"instance": updated}

@router.get("/api/process/instances/{iid}")
def get_instance_detail(iid: int):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Not found")

    files = get_instance_files(iid)

    if instance.get("templateId") is None:
        return {"instance": instance, "nodes": [], "states": [], "files": files}

    nodes = get_template_nodes(instance["templateId"])
    states = get_instance_states(iid)
    annotated = compute_gantt(nodes, states)
    return {"instance": instance, "nodes": annotated, "states": states, "files": files}

# ─── Node detail (subtree) ────────────────────────

@router.get("/api/process/instances/{iid}/nodes/{nid}")
def get_node_detail(iid: int, nid: int):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    node = get_node(nid)
    if node is None or node["templateId"] != instance["templateId"]:
        raise HTTPException(status_code=404, detail="Node not found in this instance")
    all_nodes = get_template_nodes(instance["templateId"])
    all_states = get_instance_states(iid)
    annotated = compute_gantt(all_nodes, all_states)
    files = get_node_files(nid, iid)
    comments = get_node_comments(iid, nid)
    return {
        "instance": instance,
        "node": node,
        "allNodes": annotated,
        "states": all_states,
        "files": files,
        "comments": comments,
    }

# ─── Node states ──────────────────────────────────

@router.patch("/api/process/instances/{iid}/nodes/{nid}/state")
def patch_node_state(iid: int, nid: int, body: NodeStateUpdate):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    node = get_node(nid)
    if node is None or node["templateId"] != instance["templateId"]:
        raise HTTPException(status_code=404, detail="Node not found in this instance's template")
    return upsert_node_state(iid, nid, body.model_dump(exclude_unset=True))

# ─── Node files ───────────────────────────────────

@router.get("/api/process/nodes/{nid}/files")
def list_node_files(nid: int, instance_id: Optional[int] = None):
    return get_node_files(nid, instance_id)

@router.post("/api/process/nodes/{nid}/files", status_code=201)
async def upload_node_file(
    nid: int,
    file: UploadFile = File(...),
    instance_id: Optional[int] = Form(None),
):
    file_type = 'evidence' if instance_id is not None else 'reference'
    content = await file.read()
    return create_node_file(
        template_node_id=nid,
        instance_id=instance_id,
        file_name=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        file_type=file_type,
        content=content,
    )

@router.delete("/api/process/files/{fid}", status_code=204)
def delete_file_route(fid: int):
    delete_node_file(fid)

# ─── Instance files ───────────────────────────────────────────

@router.get("/api/process/instances/{iid}/files")
def list_instance_files(iid: int):
    return get_instance_files(iid)

@router.post("/api/process/instances/{iid}/files", status_code=201)
async def upload_instance_file_route(
    iid: int,
    file: UploadFile = File(...),
):
    content = await file.read()
    return create_instance_file(
        instance_id=iid,
        file_name=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        content=content,
    )

@router.delete("/api/process/instance-files/{fid}", status_code=204)
def delete_instance_file_route(fid: int):
    delete_instance_file(fid)

# ─── Node comments ────────────────────────────────

@router.get("/api/process/instances/{iid}/nodes/{nid}/comments")
def list_comments(iid: int, nid: int):
    return get_node_comments(iid, nid)

@router.post("/api/process/instances/{iid}/nodes/{nid}/comments", status_code=201)
def post_comment(iid: int, nid: int, body: CommentCreate):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    return create_node_comment(iid, nid, body.body, body.author)

@router.delete("/api/process/comments/{cid}", status_code=204)
def delete_comment_route(cid: int):
    delete_node_comment(cid)
