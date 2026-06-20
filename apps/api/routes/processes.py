from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from api.auth import get_current_user
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
    supplierCategoryId: Optional[int] = None

class NodeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sortOrder: Optional[int] = None
    dependsOnId: Optional[int] = None
    durationDays: Optional[int] = None
    sourceTemplateId: Optional[int] = None
    supplierCategoryId: Optional[int] = None

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
    supplierId: Optional[int] = None

class CommentCreate(BaseModel):
    body: str
    author: str = ""


# ─── Templates ────────────────────────────────────

@router.get("/api/process/templates", operation_id="process_templates_list")
def list_templates(_: dict = Depends(get_current_user)):
    return get_templates()

@router.post("/api/process/templates", status_code=201, operation_id="process_templates_create")
def post_template(body: TemplateCreate, _: dict = Depends(get_current_user)):
    return create_template(body.model_dump())

@router.patch("/api/process/templates/{tid}", operation_id="process_templates_update")
def patch_template(tid: int, body: TemplateUpdate, _: dict = Depends(get_current_user)):
    updated = update_template(tid, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return updated

@router.delete("/api/process/templates/{tid}", status_code=204, operation_id="process_templates_delete")
def delete_template_route(tid: int, _: dict = Depends(get_current_user)):
    if get_template(tid) is None:
        raise HTTPException(status_code=404, detail="Template not found")
    delete_template(tid)

# ─── Nodes ────────────────────────────────────────

@router.get("/api/process/templates/{tid}/nodes", operation_id="process_template_nodes_list")
def list_template_nodes(tid: int, _: dict = Depends(get_current_user)):
    return get_template_nodes(tid)

@router.post("/api/process/templates/{tid}/nodes", status_code=201, operation_id="process_template_nodes_create")
def post_node(tid: int, body: NodeCreate, _: dict = Depends(get_current_user)):
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

@router.patch("/api/process/nodes/{nid}", operation_id="process_nodes_update")
def patch_node(nid: int, body: NodeUpdate, _: dict = Depends(get_current_user)):
    updated = update_node(nid, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return updated

@router.delete("/api/process/nodes/{nid}", status_code=204, operation_id="process_nodes_delete")
def delete_node_route(nid: int, _: dict = Depends(get_current_user)):
    if get_node(nid) is None:
        raise HTTPException(status_code=404, detail="Node not found")
    delete_node(nid)

@router.get("/api/process/templates/{tid}/preview", operation_id="process_template_preview")
def get_template_preview(tid: int, _: dict = Depends(get_current_user)):
    template = get_template(tid)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    nodes = get_template_nodes(tid)
    nodes = compute_gantt(nodes)
    return {"template": template, "nodes": nodes}

# ─── Instances ────────────────────────────────────

@router.get("/api/process/instances", operation_id="process_instances_list")
def list_instances(project_id: Optional[int] = None, _: dict = Depends(get_current_user)):
    return get_instances(project_id=project_id)

@router.post("/api/process/instances", status_code=201, operation_id="process_instances_create")
def post_instance(body: InstanceCreate, _: dict = Depends(get_current_user)):
    return create_instance(body.model_dump())

@router.patch("/api/process/instances/{iid}", operation_id="process_instances_update")
def patch_instance(iid: int, body: InstanceUpdate, _: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    data = body.model_dump(exclude_unset=True)

    # Record completion time for periodic auto-scheduling
    if data.get("status") == "completed":
        data["completedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    updated = update_instance(iid, data)
    if updated is None:
        raise HTTPException(status_code=404, detail="Instance not found")

    return {"instance": updated}

@router.get("/api/process/instances/{iid}", operation_id="process_instances_get")
def get_instance_detail(iid: int, _: dict = Depends(get_current_user)):
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

@router.get("/api/process/instances/{iid}/nodes/{nid}", operation_id="process_instance_node_get")
def get_node_detail(iid: int, nid: int, _: dict = Depends(get_current_user)):
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

@router.patch("/api/process/instances/{iid}/nodes/{nid}/state", operation_id="process_instance_node_state_update")
def patch_node_state(iid: int, nid: int, body: NodeStateUpdate, _: dict = Depends(get_current_user)):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    node = get_node(nid)
    if node is None or node["templateId"] != instance["templateId"]:
        raise HTTPException(status_code=404, detail="Node not found in this instance's template")
    return upsert_node_state(iid, nid, body.model_dump(exclude_unset=True))

# ─── Node files ───────────────────────────────────

@router.get("/api/process/nodes/{nid}/files", operation_id="process_node_files_list")
def list_node_files(nid: int, instance_id: Optional[int] = None, _: dict = Depends(get_current_user)):
    return get_node_files(nid, instance_id)

@router.post("/api/process/nodes/{nid}/files", status_code=201, operation_id="process_node_files_upload")
async def upload_node_file(
    nid: int,
    file: UploadFile = File(...),
    instance_id: Optional[int] = Form(None),
    _: dict = Depends(get_current_user),
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

@router.delete("/api/process/files/{fid}", status_code=204, operation_id="process_files_delete")
def delete_file_route(fid: int, _: dict = Depends(get_current_user)):
    delete_node_file(fid)

# ─── Instance files ───────────────────────────────────────────

@router.get("/api/process/instances/{iid}/files", operation_id="process_instance_files_list")
def list_instance_files(iid: int, _: dict = Depends(get_current_user)):
    return get_instance_files(iid)

@router.post("/api/process/instances/{iid}/files", status_code=201, operation_id="process_instance_files_upload")
async def upload_instance_file_route(
    iid: int,
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
):
    content = await file.read()
    return create_instance_file(
        instance_id=iid,
        file_name=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        content=content,
    )

@router.delete("/api/process/instance-files/{fid}", status_code=204, operation_id="process_instance_files_delete")
def delete_instance_file_route(fid: int, _: dict = Depends(get_current_user)):
    delete_instance_file(fid)

# ─── Node comments ────────────────────────────────

@router.get("/api/process/instances/{iid}/nodes/{nid}/comments", operation_id="process_node_comments_list")
def list_comments(iid: int, nid: int, _: dict = Depends(get_current_user)):
    return get_node_comments(iid, nid)

@router.post("/api/process/instances/{iid}/nodes/{nid}/comments", status_code=201, operation_id="process_node_comments_create")
def post_comment(iid: int, nid: int, body: CommentCreate, _: dict = Depends(get_current_user)):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    return create_node_comment(iid, nid, body.body, body.author)

@router.delete("/api/process/comments/{cid}", status_code=204, operation_id="process_comments_delete")
def delete_comment_route(cid: int, _: dict = Depends(get_current_user)):
    delete_node_comment(cid)
