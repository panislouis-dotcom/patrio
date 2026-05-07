from dataclasses import asdict
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from api.db import (
    get_prospects, get_prospect, update_prospect, create_prospect,
    get_projects, get_project, update_project, create_project,
    get_signals, create_signal, dismiss_signal, import_signal,
    get_team_members, get_team_member, create_team_member, update_team_member, delete_team_member,
)
from api.process_db import (
    get_templates, get_template, create_template, update_template, delete_template,
    get_template_nodes, get_node, create_node, update_node, delete_node,
    get_instances, get_instance, create_instance, update_instance,
    upsert_node_state, get_instance_states,
)
from api.gantt import compute_gantt
from api.checks import run_checks
from scraper import mercadolibre, pincali, inmuebles24, doorvel, nuroa

app = FastAPI(title="Refigan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)


class ProspectUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None
    url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    sqmLand: Optional[float] = None
    sqmConstruction: Optional[float] = None
    landPrice: Optional[float] = None
    acquisitionCostPct: Optional[float] = None
    permitsCost: Optional[float] = None
    subdivisionCost: Optional[float] = None
    constructionCostPerSqm: Optional[float] = None
    constructionOverhead: Optional[float] = None
    projectedSale: Optional[float] = None
    rentMonthly: Optional[float] = None
    holdMonths: Optional[int] = None
    notes: Optional[str] = None


class ProspectCreate(BaseModel):
    name: str
    address: str
    city: str
    status: str
    holdMonths: int = 12
    url: str = "https://refigan.mx"
    latitude: float = 0.0
    longitude: float = 0.0
    sqmLand: float = 0.0
    sqmConstruction: float = 0.0
    landPrice: float = 0.0
    acquisitionCostPct: float = 0.065
    permitsCost: float = 0.0
    subdivisionCost: float = 0.0
    constructionCostPerSqm: float = 0.0
    constructionOverhead: float = 1.3
    projectedSale: float = 0.0
    rentMonthly: float = 0.0
    notes: str = "-"


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None
    url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    totalUnits: Optional[int] = None
    acquisitionDate: Optional[str] = None
    firstRentDate: Optional[str] = None
    totalInvestment: Optional[float] = None
    currentValuation: Optional[float] = None
    valuationDate: Optional[str] = None
    milestones: Optional[dict] = None
    budget: Optional[dict] = None
    notes: Optional[str] = None


class ProjectCreate(BaseModel):
    name: str
    type: str
    address: str
    city: str
    status: str
    totalUnits: int
    acquisitionDate: str
    firstRentDate: str
    totalInvestment: float
    currentValuation: float
    valuationDate: str
    url: str = "https://refigan.mx"
    latitude: float = 0.0
    longitude: float = 0.0
    milestones: dict = Field(default_factory=dict)
    budget: dict = Field(default_factory=dict)
    notes: str = "-"


class TeamMemberCreate(BaseModel):
    name: str
    role: str
    managerId: Optional[int] = None
    notes: str = ""


class TeamMemberUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    managerId: Optional[int] = None
    notes: Optional[str] = None


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


def _with_checks(p: dict) -> dict:
    issues = [asdict(i) for i in run_checks(p)]
    return {**p, "issues": issues}


def _score(p: dict, all_prospects: list[dict]) -> float:
    """Weighted percentile rank: ROI 50%, capRate 30%, profit 20%. Returns 0-100."""
    weights = {"roi": 0.5, "capRate": 0.3, "profit": 0.2}
    total = 0.0
    for field, weight in weights.items():
        values = [x.get(field) or 0 for x in all_prospects]
        v = p.get(field) or 0
        below = sum(1 for x in values if x < v)
        ties = sum(1 for x in values if x == v)
        pct = (below + 0.5 * ties) / len(values) if values else 0.5
        total += pct * weight
    return round(total * 100)


@app.get("/api/prospects")
def list_prospects():
    prospects = get_prospects()
    return [_with_checks({**p, "score": _score(p, prospects)}) for p in prospects]


@app.get("/api/prospects/{prospect_id}")
def detail_prospect(prospect_id: int):
    p = get_prospect(prospect_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    all_prospects = get_prospects()
    return _with_checks({**p, "score": _score(p, all_prospects)})


@app.get("/api/quality")
def quality_report():
    prospects = get_prospects()
    return [
        {"id": p["id"], "name": p["name"],
         "issues": [asdict(i) for i in run_checks(p)]}
        for p in prospects
    ]


@app.patch("/api/prospects/{prospect_id}")
def patch_prospect(prospect_id: int, body: ProspectUpdate):
    payload = body.model_dump(exclude_none=True)
    updated = update_prospect(prospect_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Prospect not found")
    all_prospects = get_prospects()
    return _with_checks({**updated, "score": _score(updated, all_prospects)})


@app.post("/api/prospects", status_code=201)
def post_prospect(body: ProspectCreate):
    created = create_prospect(body.model_dump(exclude_none=False))
    if created is None:
        raise HTTPException(status_code=500, detail="Prospect created but not retrievable")
    all_prospects = get_prospects()
    return _with_checks({**created, "score": _score(created, all_prospects)})


@app.get("/api/projects")
def list_projects():
    return get_projects()


@app.get("/api/projects/{project_id}")
def detail_project(project_id: int):
    p = get_project(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: int, body: ProjectUpdate):
    payload = body.model_dump(exclude_none=True)
    updated = update_project(project_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@app.post("/api/projects", status_code=201)
def post_project(body: ProjectCreate):
    created = create_project(body.model_dump(exclude_none=False))
    if created is None:
        raise HTTPException(status_code=500, detail="Project created but not retrievable")
    return created


@app.post("/api/sonar/scan")
def sonar_scan():
    scrapers = [mercadolibre, pincali, inmuebles24, doorvel, nuroa]
    total_new = 0
    errors = []
    for scraper in scrapers:
        try:
            signals = scraper.scrape(city="Monterrey")
            for s in signals:
                inserted = create_signal({
                    "portal": s.portal,
                    "url": s.url,
                    "title": s.title,
                    "address": s.address,
                    "city": s.city,
                    "price": s.price,
                    "sqm_land": s.sqm_land,
                })
                if inserted:
                    total_new += 1
        except Exception as e:
            errors.append({"portal": scraper.PORTAL_NAME, "error": str(e)})
    return {"scanned": len(scrapers), "new": total_new, "errors": errors}


@app.get("/api/sonar/signals")
def list_signals(status: str | None = None, portal: str | None = None):
    return get_signals(status=status, portal=portal)


@app.patch("/api/sonar/signals/{signal_id}")
def patch_signal(signal_id: int):
    updated = dismiss_signal(signal_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    return updated


@app.post("/api/sonar/signals/{signal_id}/import", status_code=201)
def import_signal_route(signal_id: int):
    signal, prospect = import_signal(signal_id)
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    return {"signal": signal, "prospect": prospect}


@app.get("/api/team")
def list_team():
    return get_team_members()


@app.post("/api/team", status_code=201)
def post_team_member(body: TeamMemberCreate):
    return create_team_member(body.model_dump(exclude_none=False))


@app.patch("/api/team/{member_id}")
def patch_team_member(member_id: int, body: TeamMemberUpdate):
    payload = body.model_dump(exclude_none=True)
    updated = update_team_member(member_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Team member not found")
    return updated


@app.delete("/api/team/{member_id}", status_code=204)
def delete_team_member_route(member_id: int):
    member = get_team_member(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Team member not found")
    delete_team_member(member_id)


# ─── Process templates ────────────────────────────

@app.get("/api/process/templates")
def list_templates():
    return get_templates()

@app.post("/api/process/templates", status_code=201)
def post_template(body: TemplateCreate):
    return create_template(body.model_dump())

@app.patch("/api/process/templates/{tid}")
def patch_template(tid: int, body: TemplateUpdate):
    updated = update_template(tid, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return updated

@app.delete("/api/process/templates/{tid}", status_code=204)
def delete_template_route(tid: int):
    t = get_template(tid)
    if t is None:
        raise HTTPException(status_code=404, detail="Template not found")
    delete_template(tid)

# ─── Template nodes ───────────────────────────────

@app.get("/api/process/templates/{tid}/nodes")
def list_template_nodes(tid: int):
    return get_template_nodes(tid)

@app.post("/api/process/templates/{tid}/nodes", status_code=201)
def post_node(tid: int, body: NodeCreate):
    data = body.model_dump()
    data["templateId"] = tid
    return create_node(data)

@app.patch("/api/process/nodes/{nid}")
def patch_node(nid: int, body: NodeUpdate):
    updated = update_node(nid, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return updated

@app.delete("/api/process/nodes/{nid}", status_code=204)
def delete_node_route(nid: int):
    n = get_node(nid)
    if n is None:
        raise HTTPException(status_code=404, detail="Node not found")
    delete_node(nid)


@app.get("/api/process/templates/{tid}/preview")
def get_template_preview(tid: int):
    template = get_template(tid)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    nodes = get_template_nodes(tid)
    compute_gantt(nodes)
    return {"template": template, "nodes": nodes}

# ─── Process instances ────────────────────────────

@app.get("/api/process/instances")
def list_instances(project_id: Optional[int] = None):
    return get_instances(project_id=project_id)

@app.post("/api/process/instances", status_code=201)
def post_instance(body: InstanceCreate):
    return create_instance(body.model_dump())

@app.patch("/api/process/instances/{iid}")
def patch_instance(iid: int, body: InstanceUpdate):
    updated = update_instance(iid, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    return updated

@app.get("/api/process/instances/{iid}")
def get_instance_detail(iid: int):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    nodes = get_template_nodes(instance["templateId"])
    compute_gantt(nodes)
    states = get_instance_states(iid)
    return {"instance": instance, "nodes": nodes, "states": states}

# ─── Node states ──────────────────────────────────

@app.patch("/api/process/instances/{iid}/nodes/{nid}/state")
def patch_node_state(iid: int, nid: int, body: NodeStateUpdate):
    instance = get_instance(iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    node = get_node(nid)
    if node is None or node["templateId"] != instance["templateId"]:
        raise HTTPException(status_code=404, detail="Node not found in this instance's template")
    return upsert_node_state(iid, nid, body.model_dump(exclude_none=True))
