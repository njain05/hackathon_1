"""Make the public demo college for evaluators on a running server.

    python seed_demo.py https://college-timetable-api.onrender.com

It creates the college from docs/demo-college.json, generates and publishes its
timetable, and makes one sign-in per role (dean, hod, incharge, teacher, student),
all with the password "demo1234". These sign-ins are public on purpose: they open
only this demo college. Run it again to get a fresh demo college if someone changed
it; then put the printed code in frontend/lib/demo.ts.
"""

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

PASSWORD = "demo1234"


def call(base: str, path: str, body: Any = None, headers: dict[str, str] | None = None, method: str | None = None) -> Any:
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method or ("GET" if body is None else "POST"),
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        raw = res.read()
        return json.loads(raw) if raw else None


def main(base: str) -> None:
    data = json.loads((Path(__file__).resolve().parent.parent / "docs" / "demo-college.json").read_text())
    college = call(base, "/colleges", {"name": data["name"], "data": data})
    code, dean = college["code"], {"X-Admin-Key": college["admin_key"]}
    call(base, f"/colleges/{code}/data", data, dean, method="PUT")
    result = call(base, "/generate?time_limit=20", data)
    assert result["status"] == "solved", result.get("problems")
    call(base, f"/colleges/{code}/publish", {"data": data, "result": result}, dean)

    dept = data["departments"][0]["id"]
    teacher = next(t for t in data["teachers"] if t["department_id"] == dept)
    section = next(s for s in data["sections"] if s["department_id"] == dept)
    call(base, f"/colleges/{code}/accounts/dean", {"username": "dean", "password": PASSWORD, "name": "Dean (demo)"}, dean)
    for body in (
        {"role": "hod", "username": "hod", "name": f"HOD of {dept} (demo)", "department_id": dept},
        {"role": "incharge", "username": "incharge", "name": f"{dept} timetable in-charge (demo)", "department_id": dept},
        {"role": "teacher", "username": "teacher", "teacher_id": teacher["id"]},
        {"role": "student", "username": "student", "name": "Student (demo)", "section_id": section["id"]},
    ):
        call(base, f"/colleges/{code}/accounts", {**body, "password": PASSWORD}, dean)
    print(f"Demo college {data['name']}: code {code}, sign-ins dean/hod/incharge/teacher/student, password {PASSWORD}")
    print(f"Teacher = {teacher['name']} ({teacher['id']}), student section = {section['id']}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000")
