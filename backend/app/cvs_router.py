"""/api/cvs — the signed-in user's CV library (create, list, load, save, duplicate, delete)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import storage
from .auth import User, current_user
from .models import CV

router = APIRouter(prefix="/api/cvs", tags=["cvs"])

MAX_CVS_PER_USER = 100


class CVCreate(BaseModel):
    name: str = Field(default="Untitled CV", max_length=120)
    data: CV | None = None
    sourceId: str | None = Field(default=None, description="Duplicate one of your CVs")


class CVUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    data: CV | None = None


@router.get("")
def list_cvs(user: User = Depends(current_user)):
    return storage.list_cvs(user.id)


@router.post("", status_code=201)
def create_cv(body: CVCreate, user: User = Depends(current_user)):
    if len(storage.list_cvs(user.id)) >= MAX_CVS_PER_USER:
        raise HTTPException(400, f"You can keep up to {MAX_CVS_PER_USER} CVs. Delete one first.")
    if body.sourceId:
        src = storage.get_cv(user.id, body.sourceId)
        if not src:
            raise HTTPException(404, "CV to duplicate not found")
        return storage.create_cv(user.id, body.name, CV.model_validate(src["data"]))
    return storage.create_cv(user.id, body.name, body.data or CV())


@router.get("/{cv_id}")
def get_cv(cv_id: str, user: User = Depends(current_user)):
    found = storage.get_cv(user.id, cv_id)
    if not found:
        raise HTTPException(404, "CV not found")
    return found


@router.put("/{cv_id}")
def update_cv(cv_id: str, body: CVUpdate, user: User = Depends(current_user)):
    updated = storage.update_cv(user.id, cv_id, body.name, body.data)
    if not updated:
        raise HTTPException(404, "CV not found")
    return updated


@router.delete("/{cv_id}", status_code=204)
def delete_cv(cv_id: str, user: User = Depends(current_user)):
    if not storage.delete_cv(user.id, cv_id):
        raise HTTPException(404, "CV not found")
