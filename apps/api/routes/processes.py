from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.process_db import (
    get_templates, get_template, create_template, update_template, delete_template,
    get_template_nodes, get_node, create_node, update_node, delete_node,
    get_instances, get_instance, create_instance, update_instance,
    upsert_node_state, get_instance_states,
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

class NodeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sortOrder: Optional[int] = None
    dependsOnId: Optional[int] = None
    durationDays: Optional[int] = None

class InstanceCreate(BaseModel):
    name: str
    templateId: int
    startDate: str
    projectId: Optional[int] = None
    notes: str = ""
    status: str = "active"

class InstanceUpdate(BaseModel):
    name: Optional[str] = None
    startDate: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class NodeStateUpdate(BaseModel):
    status: Optional[str] = None
    assigneeId: Optional[int] = None
    actualStart: Optional[str] = None
    actualEnd: Optional[str] = None
    notes: Optional[str] = None


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
    data["templateId"] = tid
    return create_node(data)

@router.patch("/api/process/nodes/{nid}")
def patch_node(nid: int, body: NodeUpdate):
    updated = update_node(nid, body.model_dump(exclude_none=True))
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
    compute_gantt(nodes)
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
    updated = update_instance(iid, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    return updated

@router.get("/api/process/instances/{iid}")
def get_instance_detail(iid: int):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    nodes = get_template_nodes(instance["templateId"])
    states = get_instance_states(iid)
    annotated = compute_gantt(nodes, states)
    return {"instance": instance, "nodes": annotated, "states": states}

# ─── Node states ──────────────────────────────────

@router.patch("/api/process/instances/{iid}/nodes/{nid}/state")
def patch_node_state(iid: int, nid: int, body: NodeStateUpdate):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    node = get_node(nid)
    if node is None or node["templateId"] != instance["templateId"]:
        raise HTTPException(status_code=404, detail="Node not found in this instance's template")
    return upsert_node_state(iid, nid, body.model_dump(exclude_none=True))
