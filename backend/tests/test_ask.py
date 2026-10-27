import logging
from collections.abc import Callable, Iterator
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

from app import ask, db
from app.main import app
from assistant.chat import MAX_ROUNDS, MODEL, REFUSED
from solver import SolveResult, sample_college

client = TestClient(app)
MONDAY = date.today() + timedelta(days=7 + (7 - date.today().weekday()) % 7)
NOW = f"{MONDAY.isoformat()}T10:15"


@pytest.fixture(autouse=True)
def fresh(tmp_path: Path) -> Iterator[None]:
    db.configure(f"sqlite:///{tmp_path / 'test.db'}")
    ask.limiter = ask.RateLimiter()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def college(sample_result: SolveResult) -> dict[str, Any]:
    c = client.post("/colleges", json={"name": "Sample College"}).json()
    admin = {"X-Admin-Key": c["admin_key"]}
    body = {"data": sample_college().model_dump(mode="json"), "result": sample_result.model_dump(mode="json")}
    assert client.post(f"/colleges/{c['code']}/publish", json=body, headers=admin).status_code == 200
    return {**c, "admin": admin}


def text(t: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=t)


def tool(name: str, **args: Any) -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", id=f"tu_{name}", name=name, input=args)


class FakeClaude:
    """Plays back scripted responses. A step may be a function of the request (to read tool results)."""

    def __init__(self, *steps: SimpleNamespace | Callable[[dict[str, Any]], SimpleNamespace]) -> None:
        self.steps = list(steps)
        self.calls: list[dict[str, Any]] = []
        self.messages = self

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        step = self.steps.pop(0) if len(self.steps) > 1 else self.steps[0]
        return step(kwargs) if callable(step) else step


def reply(stop: str, *blocks: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(stop_reason=stop, content=list(blocks))


def last_tool_results(kwargs: dict[str, Any]) -> list[dict[str, Any]]:
    return kwargs["messages"][-1]["content"]


def use(fake: FakeClaude) -> FakeClaude:
    app.dependency_overrides[ask.get_claude] = lambda: fake
    return fake


def ask_q(c: dict[str, Any], question: str, **extra: Any) -> Any:
    return client.post(f"/colleges/{c['code']}/ask", json={"question": question, "now": NOW, **extra})


def test_a_tool_call_returns_real_timetable_data(college: dict[str, Any], sample_result: SolveResult) -> None:
    data = sample_college()
    subjects = {s.id: s.name for s in data.subjects}
    monday = sorted((e for e in sample_result.entries if e.day == "Monday" and e.section_id == "CSE-3A"), key=lambda e: e.period)
    seen: dict[str, str] = {}

    def summarise(kwargs: dict[str, Any]) -> SimpleNamespace:
        (result,) = last_tool_results(kwargs)
        seen["tool_result"] = result["content"]
        return reply("end_turn", text("On Monday CSE-3A starts with " + subjects[monday[0].subject_id] + "."))

    fake = use(FakeClaude(reply("tool_use", text("Let me check."), tool("get_schedule", who="CSE-3A", day="Monday")), summarise))
    res = ask_q(college, "What does CSE-3A have on Monday?")
    assert res.status_code == 200
    body = res.json()
    assert body["tools_used"] == ["get_schedule"]
    assert subjects[monday[0].subject_id] in body["answer"]

    # The tool result is the real Monday timetable: every class, with its room and time.
    for e in monday:
        assert subjects[e.subject_id] in seen["tool_result"]
    assert f"P{monday[0].period}" in seen["tool_result"]  # with its period (the solver may not start at period 1)

    # The request is shaped as the current API expects.
    first = fake.calls[0]
    assert first["model"] == MODEL == "claude-haiku-5-5"
    assert first["max_tokens"] <= 2048 and first["output_config"] == {"effort": "low"}
    assert not {"temperature", "top_p", "top_k", "tool_choice"} & first.keys()
    assert all(t["strict"] and t["input_schema"]["additionalProperties"] is False for t in first["tools"])
    assert "Never guess or invent" in first["system"] and data.name in first["system"]


def test_missing_key_gives_a_friendly_message(college: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = ask_q(college, "Where is my next class?")
    assert res.status_code == 503
    assert res.json()["detail"] == ask.NOT_SET_UP


def test_rejected_key_is_friendly_and_never_shown(
    college: dict[str, Any], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    secret = "sk-ant-test-SECRET123"
    monkeypatch.setenv("ANTHROPIC_API_KEY", secret)

    class Refusing:
        messages = None

        def __init__(self) -> None:
            self.messages = self

        def create(self, **kwargs: Any) -> Any:
            req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.AuthenticationError("invalid x-api-key", response=httpx2.Response(401, request=req), body=None)

    app.dependency_overrides[ask.get_claude] = lambda: Refusing()
    with caplog.at_level(logging.DEBUG):
        res = ask_q(college, "Where is my next class?")
    assert res.status_code == 503
    assert res.json()["detail"] == ask.KEY_REJECTED
    assert secret not in res.text and secret not in caplog.text


def test_unreachable_api_is_friendly(college: dict[str, Any]) -> None:
    class Down:
        def __init__(self) -> None:
            self.messages = self

        def create(self, **kwargs: Any) -> Any:
            raise anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))

    app.dependency_overrides[ask.get_claude] = lambda: Down()
    res = ask_q(college, "Where is my next class?")
    assert res.status_code == 503 and res.json()["detail"] == ask.UNREACHABLE


def test_rate_limit_per_ip(college: dict[str, Any]) -> None:
    ask.limiter = ask.RateLimiter(per_minute=2)
    use(FakeClaude(reply("end_turn", text("Hi."))))
    assert ask_q(college, "Hello?").status_code == 200
    assert ask_q(college, "Hello?").status_code == 200
    res = ask_q(college, "Hello?")
    assert res.status_code == 429 and res.json()["detail"] == ask.TOO_FAST
    # Another address isn't affected.
    other = client.post(f"/colleges/{college['code']}/ask", json={"question": "Hi", "now": NOW}, headers={"X-Forwarded-For": "10.0.0.9"})
    assert other.status_code == 200


def test_loop_is_capped_and_refusals_are_handled(college: dict[str, Any]) -> None:
    fake = use(FakeClaude(reply("tool_use", tool("free_rooms", day="today", period=3))))
    res = ask_q(college, "Rooms?")
    assert res.status_code == 200
    assert len(fake.calls) == MAX_ROUNDS + 1  # never loops forever
    assert "couldn't work that out" in res.json()["answer"]

    use(FakeClaude(reply("refusal")))
    assert ask_q(college, "Write me an essay").json()["answer"] == REFUSED


def test_bad_tool_calls_come_back_as_errors(college: dict[str, Any]) -> None:
    seen: dict[str, Any] = {}

    def check(kwargs: dict[str, Any]) -> SimpleNamespace:
        seen["results"] = last_tool_results(kwargs)
        return reply("end_turn", text("Sorry."))

    use(FakeClaude(reply("tool_use", tool("delete_everything"), tool("get_schedule", who="CSE-3A")), check))
    assert ask_q(college, "x").status_code == 200
    bad, wrong_args = seen["results"]  # both results in ONE user message
    assert bad["is_error"] and "no tool called" in bad["content"]
    assert wrong_args["is_error"] and "Wrong arguments" in wrong_args["content"]


def test_unpublished_college_says_so() -> None:
    c = client.post("/colleges", json={"name": "Empty"}).json()
    use(FakeClaude(reply("end_turn", text("x"))))
    res = client.post(f"/colleges/{c['code']}/ask", json={"question": "Next class?"})
    assert res.status_code == 409 and "hasn't published" in res.json()["detail"]


# ---------- The tools on real data ----------


def context(college: dict[str, Any], **body: Any) -> Any:
    with next(db.get_session()) as session:
        c = ask.find_college(session, college["code"])
        return ask.build_context(session, c, ask.AskIn(question="x", now=NOW, **body)), session


def test_tools_answer_from_the_real_day(college: dict[str, Any], sample_result: SolveResult) -> None:
    from assistant.tools import free_rooms, get_schedule, hall_free_slots, teacher_free_slots, whats_next

    ctx, _ = context(college, me={"role": "section", "id": "CSE-3A"})
    monday = [e for e in sample_result.entries if e.day == "Monday"]

    assert get_schedule(ctx, "Nobody Here", "today").startswith('No section or teacher matches "Nobody Here"')
    assert "isn't a day I understand" in get_schedule(ctx, "CSE-3A", "someday")
    assert "no classes run on this day" in get_schedule(ctx, "CSE-3A", "Sunday")
    assert "Sample" not in get_schedule(ctx, "me", "today")  # "me" is CSE-3A
    assert get_schedule(ctx, "me", "today").startswith("CSE 3rd Sem A (CSE-3A)")

    used_p3 = {e.room_id for e in monday if e.period == 3}
    rooms = free_rooms(ctx, "today", 3)
    assert all(f"({r})" not in rooms for r in used_p3)
    assert "Seminar Hall" not in rooms  # halls aren't classrooms

    hk = {e.period for e in monday if e.teacher_id == "HK"}
    slots = teacher_free_slots(ctx, "Harpreet", "Monday")
    free_line = next(line for line in slots.splitlines() if line.startswith("Free:"))
    assert all(f"P{p} " not in free_line for p in hk)

    nxt = whats_next(ctx, "me", "now")
    assert "it is 10:15" in nxt and ("Next:" in nxt or "No more classes today" in nxt)

    assert "Free: P1" in hall_free_slots(ctx, "seminar", "today")
    assert 'No hall matches "gym"' in hall_free_slots(ctx, "gym", "today")


def test_tools_include_the_days_changes(college: dict[str, Any], sample_result: SolveResult) -> None:
    from assistant.tools import get_schedule, hall_free_slots

    e = next(x for x in sample_result.entries if x.day == "Monday" and x.section_id == "CSE-3A" and x.kind == "lecture")
    res = client.post(f"/colleges/{college['code']}/changes", headers=college["admin"],
                      json={"date": MONDAY.isoformat(), "kind": "cancel", "section_id": "CSE-3A", "start_period": e.period})
    assert res.status_code == 201
    booking = client.post(f"/colleges/{college['code']}/bookings", json={
        "room_id": "SH-1", "date": MONDAY.isoformat(), "start_period": 1, "end_period": 2, "title": "Talk",
        "attendees": 50, "organiser": "A", "club": "B", "contact": "a@b.c"})
    assert booking.status_code == 201

    ctx, _ = context(college)
    sched = get_schedule(ctx, "CSE-3A", "today")
    assert "Cancelled:" in sched and f"P{e.period} " in sched.split("Changes:")[1]
    assert f"P{e.period} " not in sched.split("Changes:")[0].split("\n", 1)[1]
    hall = hall_free_slots(ctx, "SH-1", "today")
    assert "Taken: P1 09:00–09:50 (requested by an organiser)" in hall


def test_explain_problems_uses_what_the_admin_sent(college: dict[str, Any]) -> None:
    from assistant.tools import explain_problems

    ctx, _ = context(college, problems=["Not enough lab time for CSE-3A."])
    assert "Not enough lab time" in explain_problems(ctx)
    ctx, _ = context(college, penalties={"teacher_load_imbalance": 16, "student_gaps": 0})
    assert "uneven teacher load across days: 16" in explain_problems(ctx)


def test_status_says_only_whether_the_helper_is_set_up(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.get("/assistant/status").json() == {"ready": False}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-SECRET456")
    res = client.get("/assistant/status")
    assert res.json() == {"ready": True} and "SECRET456" not in res.text
