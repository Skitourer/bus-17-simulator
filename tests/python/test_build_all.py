"""Unit tests of the build progress (no download, no build)."""

import pytest
from build_all import STEPS, steps_from
from sources import progress, progress_bar


def test_progress_bar_fills_with_the_share_done() -> None:
    assert progress_bar(0, 4, 4) == '[----]   0 %'
    assert progress_bar(1, 4, 4) == '[#---]  25 %'
    assert progress_bar(4, 4, 4) == '[####] 100 %'
    assert progress_bar(0, 0, 4) == '[####] 100 %'


def test_progress_prints_one_line_per_tenth_in_a_log(capsys: pytest.CaptureFixture[str]) -> None:
    for done in range(1, 101):
        progress('test', done, 100)
    # 0 %, 10 %, ..., 100 %
    assert len(capsys.readouterr().out.splitlines()) == 11


def test_steps_from_resumes_at_a_step() -> None:
    assert [name for name, _, _ in steps_from('streets')] == ['streets', 'landmarks']
    assert len(steps_from('line')) == len(STEPS)
    with pytest.raises(SystemExit):
        steps_from('nowhere')
