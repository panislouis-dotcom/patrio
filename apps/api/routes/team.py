from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.db import get_team_members, get_team_member, create_team_member, update_team_member, delete_team_member

router = APIRouter()


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


@router.get("/api/team")
def list_team():
    return get_team_members()


@router.post("/api/team", status_code=201)
def post_team_member(body: TeamMemberCreate):
    return create_team_member(body.model_dump(exclude_none=False))


@router.patch("/api/team/{member_id}")
def patch_team_member(member_id: int, body: TeamMemberUpdate):
    payload = body.model_dump(exclude_none=True)
    updated = update_team_member(member_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Team member not found")
    return updated


@router.delete("/api/team/{member_id}", status_code=204)
def delete_team_member_route(member_id: int):
    member = get_team_member(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Team member not found")
    delete_team_member(member_id)
