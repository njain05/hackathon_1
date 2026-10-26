"""Ask the timetable: a Claude helper that answers only from the real timetable.

Pure module like solver/: no FastAPI or database code. The app builds a
`Context` from the published timetable and passes in the Claude client.
"""

from .chat import MODEL, Answer, answer
from .tools import TOOLS, Context, run_tool

__all__ = ["MODEL", "TOOLS", "Answer", "Context", "answer", "run_tool"]
