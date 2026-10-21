import pytest

from solver import SolveResult, sample_college, solve


@pytest.fixture(scope="session")
def sample_result() -> SolveResult:
    """Solve the sample college once and share it across tests (solving takes a few seconds)."""
    return solve(sample_college(), time_limit_seconds=20)
