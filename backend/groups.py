"""그룹 CRUD 및 broadcast API 라우트."""

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from backend.constants import (
    MAX_BROADCAST_TEXT_LENGTH,
    MAX_GROUP_MEMBERS,
    MAX_GROUPS,
    PREFIX,
)

router = APIRouter()


@router.get("/api/groups")
async def api_list_groups() -> List[Dict[str, Any]]:
    """전체 그룹 목록 반환 (멤버 세션의 alive/name 포함)."""
    import backend.app as _app

    groups = _app.load_group_meta()
    session_meta = _app.load_session_meta()
    alive_sessions = _app.list_tmux_sessions()

    result: List[Dict[str, Any]] = []
    for gid, info in groups.items():
        members: List[Dict[str, Any]] = []
        for m in info.get("members", []):
            sid = m.get("session_id", "")
            s_info = session_meta.get(sid, {})
            tmux_name = f"{PREFIX}{sid}"
            members.append({
                "session_id": sid,
                "role": m.get("role", ""),
                "name": s_info.get("name", sid),
                "alive": tmux_name in alive_sessions,
                "exists": sid in session_meta,
            })
        result.append({
            "group_id": gid,
            "name": info.get("name", ""),
            "members": members,
        })
    return result


@router.post("/api/groups")
async def api_create_group(body: Dict[str, Any]) -> Dict[str, Any]:
    """새 그룹 생성."""
    import backend.app as _app

    async with _app._meta_lock:
        groups = _app.load_group_meta()

        if len(groups) >= MAX_GROUPS:
            raise HTTPException(
                status_code=429,
                detail=f"최대 그룹 수({MAX_GROUPS}개)에 도달했습니다",
            )

        name = body.get("name", "그룹")
        members_raw = body.get("members", [])
        if len(members_raw) > MAX_GROUP_MEMBERS:
            raise HTTPException(
                status_code=400,
                detail=f"멤버는 최대 {MAX_GROUP_MEMBERS}명까지 가능합니다",
            )

        session_meta = _app.load_session_meta()
        members: List[Dict[str, str]] = []
        for m in members_raw:
            sid = str(m.get("session_id", ""))
            if sid not in session_meta:
                raise HTTPException(
                    status_code=400,
                    detail=f"세션 '{sid}'이(가) 존재하지 않습니다",
                )
            members.append({
                "session_id": sid,
                "role": m.get("role", ""),
            })

        existing_nums: List[int] = []
        for k in groups:
            try:
                existing_nums.append(int(k))
            except ValueError:
                pass
        gid = str(max(existing_nums, default=0) + 1)

        groups[gid] = {"name": name, "members": members}
        _app.save_group_meta(groups)

    return {"group_id": gid, "name": name}


@router.put("/api/groups/{group_id}")
async def api_update_group(group_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """그룹 수정 (이름, 멤버)."""
    import backend.app as _app

    async with _app._meta_lock:
        groups = _app.load_group_meta()
        if group_id not in groups:
            raise HTTPException(status_code=404, detail="그룹을 찾을 수 없습니다")

        if "name" in body:
            groups[group_id]["name"] = body["name"]

        if "members" in body:
            members_raw = body["members"]
            if len(members_raw) > MAX_GROUP_MEMBERS:
                raise HTTPException(
                    status_code=400,
                    detail=f"멤버는 최대 {MAX_GROUP_MEMBERS}명까지 가능합니다",
                )
            session_meta = _app.load_session_meta()
            members: List[Dict[str, str]] = []
            for m in members_raw:
                sid = str(m.get("session_id", ""))
                if sid not in session_meta:
                    raise HTTPException(
                        status_code=400,
                        detail=f"세션 '{sid}'이(가) 존재하지 않습니다",
                    )
                members.append({
                    "session_id": sid,
                    "role": m.get("role", ""),
                })
            groups[group_id]["members"] = members

        _app.save_group_meta(groups)

    return {"ok": True}


@router.delete("/api/groups/{group_id}")
async def api_delete_group(group_id: str) -> Dict[str, bool]:
    """그룹 삭제 (세션은 유지)."""
    import backend.app as _app

    async with _app._meta_lock:
        groups = _app.load_group_meta()
        groups.pop(group_id, None)
        _app.save_group_meta(groups)
    return {"ok": True}


@router.post("/api/groups/{group_id}/broadcast")
async def api_broadcast(group_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """모든 멤버 세션에 동일 프롬프트 전송."""
    import backend.app as _app

    groups = _app.load_group_meta()
    group = groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="그룹을 찾을 수 없습니다")

    text = body.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="text 필드가 필요합니다")
    if len(text) > MAX_BROADCAST_TEXT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"텍스트가 너무 깁니다 (최대 {MAX_BROADCAST_TEXT_LENGTH}자)",
        )

    results: List[Dict[str, Any]] = []
    for m in group.get("members", []):
        sid = m["session_id"]
        tmux_name = f"{PREFIX}{sid}"
        if not _app.session_exists(tmux_name):
            results.append({"session_id": sid, "success": False, "reason": "not running"})
            continue
        try:
            _app.tmux_run("send-keys", "-t", tmux_name, "-l", text)
            _app.tmux_run("send-keys", "-t", tmux_name, "Enter")
            results.append({"session_id": sid, "success": True})
        except Exception as e:
            results.append({"session_id": sid, "success": False, "reason": str(e)})

    return {"ok": True, "results": results}
