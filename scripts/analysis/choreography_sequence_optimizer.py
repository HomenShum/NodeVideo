"""Deterministic global sequence optimization for choreography-led edits.

This module deliberately has no media/model dependencies. The analyzer supplies source-only
candidate moments and interval quality scores; the optimizer jointly chooses cut boundaries and
creator takes. A fixed beat grammar is never required or consulted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable


@dataclass(frozen=True)
class CandidateMoment:
    time_seconds: float
    evidence_score: float
    evidence: tuple[str, ...]
    choreography_landmark: str | None = None
    nearest_music_event_seconds: float | None = None
    signed_music_offset_seconds: float | None = None


@dataclass(frozen=True)
class SequenceDecision:
    boundaries: tuple[CandidateMoment, ...]
    take_ids: tuple[str, ...]
    interval_scores: tuple[float, ...]
    score: float


@dataclass(frozen=True)
class _State:
    boundaries: tuple[CandidateMoment, ...]
    take_ids: tuple[str, ...]
    interval_scores: tuple[float, ...]
    score: float


IntervalScore = Callable[[float, float, str], float]


def optimize_sequence(
    *,
    moments: Iterable[CandidateMoment],
    duration_seconds: float,
    take_ids: Iterable[str],
    interval_score: IntervalScore,
    desired_phrases: int,
    anchor_times: Iterable[float] | None = None,
    preferred_opening_take: str | None = None,
    minimum_phrase_seconds: float = 1.4,
    maximum_phrase_seconds: float = 14.0,
    beam_width: int = 96,
) -> SequenceDecision:
    """Choose a complete edit sequence with joint cut and take decisions.

    The score rewards source quality and multi-modal boundary evidence. It softly rewards a clean
    take change but penalizes rapid repetition. Phrase duration is a soft coherence prior, not a
    hardcoded musical grammar.
    """

    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")
    if desired_phrases < 2:
        raise ValueError("desired_phrases must be at least two")
    takes = tuple(sorted(set(take_ids)))
    if len(takes) < 2:
        raise ValueError("at least two take IDs are required")

    interior = tuple(
        sorted(
            (
                moment
                for moment in moments
                if minimum_phrase_seconds
                <= moment.time_seconds
                <= duration_seconds - minimum_phrase_seconds
            ),
            key=lambda value: (value.time_seconds, -value.evidence_score),
        )
    )
    if len(interior) < desired_phrases - 1:
        raise ValueError("not enough admissible candidate moments")

    target_duration = duration_seconds / desired_phrases
    anchors = tuple(anchor_times or ())
    if anchors and len(anchors) != desired_phrases - 1:
        raise ValueError("anchor_times must contain one source-only interpretation anchor per cut")
    beam = (_State((), (), (), 0.0),)
    cut_count = desired_phrases - 1
    for cut_index in range(cut_count):
        expanded: list[_State] = []
        remaining_intervals = desired_phrases - cut_index - 1
        for state in beam:
            start = state.boundaries[-1].time_seconds if state.boundaries else 0.0
            for moment in interior:
                phrase_duration = moment.time_seconds - start
                remaining_duration = duration_seconds - moment.time_seconds
                if phrase_duration < minimum_phrase_seconds or phrase_duration > maximum_phrase_seconds:
                    continue
                if remaining_duration < remaining_intervals * minimum_phrase_seconds:
                    continue
                if remaining_duration > remaining_intervals * maximum_phrase_seconds:
                    continue
                for take_id in takes:
                    quality = float(interval_score(start, moment.time_seconds, take_id))
                    transition = _transition_score(state.take_ids, take_id)
                    opening_score = 1.0 if not state.take_ids and take_id == preferred_opening_take else 0.0
                    choreography_score = 0.24 if "consensus-direction-change" in moment.evidence else 0.0
                    duration_penalty = 0.16 * abs(phrase_duration - target_duration) / target_duration
                    anchor_penalty = (
                        3.2 * abs(moment.time_seconds - anchors[cut_index]) if anchors else 0.0
                    )
                    score = (
                        state.score
                        + quality
                        + 0.42 * moment.evidence_score
                        + transition
                        + opening_score
                        + choreography_score
                        - duration_penalty
                        - anchor_penalty
                    )
                    expanded.append(
                        _State(
                            (*state.boundaries, moment),
                            (*state.take_ids, take_id),
                            (*state.interval_scores, quality),
                            score,
                        )
                    )
        if not expanded:
            raise ValueError(f"no complete sequence after cut {cut_index + 1}")
        expanded.sort(key=lambda value: value.score, reverse=True)
        beam = tuple(expanded[:beam_width])

    finals: list[_State] = []
    for state in beam:
        start = state.boundaries[-1].time_seconds
        phrase_duration = duration_seconds - start
        if phrase_duration < minimum_phrase_seconds or phrase_duration > maximum_phrase_seconds:
            continue
        for take_id in takes:
            quality = float(interval_score(start, duration_seconds, take_id))
            duration_penalty = 0.16 * abs(phrase_duration - target_duration) / target_duration
            finals.append(
                _State(
                    state.boundaries,
                    (*state.take_ids, take_id),
                    (*state.interval_scores, quality),
                    state.score
                    + quality
                    + _transition_score(state.take_ids, take_id)
                    - duration_penalty,
                )
            )
    if not finals:
        raise ValueError("no complete terminal sequence")
    winner = max(finals, key=lambda value: value.score)
    return SequenceDecision(
        boundaries=winner.boundaries,
        take_ids=winner.take_ids,
        interval_scores=winner.interval_scores,
        score=winner.score,
    )


def _transition_score(previous: tuple[str, ...], take_id: str) -> float:
    if not previous:
        return 0.0
    if take_id != previous[-1]:
        return 0.62
    penalty = -0.38
    if len(previous) >= 2 and previous[-2:] == (take_id, take_id):
        penalty -= 0.3
    return penalty
