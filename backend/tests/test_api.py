from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_generate_sample_has_zero_clashes() -> None:
    data = client.get("/sample").json()
    res = client.post("/generate", json=data, params={"time_limit": 20})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "solved"
    assert body["check"]["ok"] is True
    assert body["check"]["clashes"] == []
    assert len(body["entries"]) == 115


def test_generate_explains_infeasible() -> None:
    data = client.get("/sample").json()
    data["sections"][0]["strength"] = 500
    body = client.post("/generate", json=data).json()
    assert body["status"] == "infeasible"
    assert body["problems"][0]["suggestion"]


def test_generate_rejects_malformed_input() -> None:
    assert client.post("/generate", json={"settings": {}}).status_code == 422


def test_check_passes_sample_and_explains_overload() -> None:
    data = client.get("/sample").json()
    assert client.post("/check", json=data).json() == {"ok": True, "problems": []}
    for a in data["assignments"]:
        a["teacher_id"] = "HK"
    body = client.post("/check", json=data).json()
    assert body["ok"] is False
    assert body["problems"][0]["kind"] == "teacher_overload"
    assert body["problems"][0]["step"] == "subjects"
