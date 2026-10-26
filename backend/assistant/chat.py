"""Ask the timetable: one question in, a short answer out, using the tools.

A manual tool-use loop with Claude Haiku: Claude decides which tools to call;
we run them on real data and send the results back, at most MAX_ROUNDS
times. The client is passed in, so tests use a fake one.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol

from .tools import TOOLS, Context, college_day, day_label, hhmm, period_times, run_tool

MODEL = "claude-haiku-5-5"
MAX_TOKENS = 2048  # per call: room for brief thinking plus a short answer
MAX_ROUNDS = 4  # tool rounds per question
EFFORT = "low"  # quick chat answers

SYSTEM = """You answer questions about {college}'s timetable for students, teachers and staff.
It is {now} for the person asking.{me}
Rules:
- Every class, room, teacher and time you mention must come from a tool result in this conversation. Never guess or invent schedule details.
- If a tool says there is nothing (no classes, no free rooms, no match), say exactly that. If a name matches several people, ask which one.
- Answer in one to three short sentences of plain English. No tables or markdown headings. Use the times as the tools give them.
- Only answer questions about this college's timetable, rooms, halls and changes. For anything else, say you can only help with the timetable."""


class MessagesAPI(Protocol):
    def create(self, **kwargs: Any) -> Any: ...


class ClaudeClient(Protocol):
    @property
    def messages(self) -> MessagesAPI: ...


@dataclass
class Answer:
    text: str
    tools_used: list[str] = field(default_factory=list)


FALLBACK = "Sorry, I couldn't work that out. Try asking more simply, for example “What does CSE-3A have tomorrow?”"
REFUSED = "I can only help with questions about the timetable, rooms and halls."


def system_prompt(ctx: Context) -> str:
    day_name, _ = college_day(ctx.data, ctx.today)
    times = period_times(ctx.data, day_name)
    period_now = next((p for p, (a, b) in times.items() if a <= ctx.now_minutes < b), None)
    now = f"{day_label(ctx, ctx.today)}, {hhmm(ctx.now_minutes)}" + (f" (period {period_now})" if period_now else "")
    me = ""
    if ctx.me:
        kind, id_ = ctx.me
        me = f" They are {'a student of section' if kind == 'section' else 'the teacher with code'} {id_}; \"my\" and \"I\" mean that."
    return SYSTEM.format(college=ctx.data.name, now=now, me=me)


def answer(client: ClaudeClient, ctx: Context, question: str, history: list[tuple[str, str]] | None = None) -> Answer:
    """Answer one question. `history` is earlier (question, answer) pairs, for follow-ups like "and tomorrow?"."""
    messages: list[dict[str, Any]] = []
    for q, a in history or []:
        messages += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
    messages.append({"role": "user", "content": question})
    used: list[str] = []

    for round_ in range(MAX_ROUNDS + 1):
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system_prompt(ctx),
            tools=TOOLS,
            output_config={"effort": EFFORT},
            messages=messages,
        )
        if response.stop_reason == "refusal":
            return Answer(REFUSED, used)
        calls = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason == "tool_use" and calls and round_ < MAX_ROUNDS:
            # Send the assistant turn back unchanged (thinking blocks included), then all results in one message.
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for call in calls:
                used.append(call.name)
                try:
                    results.append({"type": "tool_result", "tool_use_id": call.id, "content": run_tool(ctx, call.name, dict(call.input))})
                except ValueError as e:
                    results.append({"type": "tool_result", "tool_use_id": call.id, "content": str(e), "is_error": True})
            messages.append({"role": "user", "content": results})
            continue
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        return Answer(text or FALLBACK, used)
    return Answer(FALLBACK, used)
