from choreography_sequence_optimizer import CandidateMoment, optimize_sequence


def test_global_search_can_reject_greedy_first_cut() -> None:
    moments = [
        CandidateMoment(3.0, 1.0, ("beat",)),
        CandidateMoment(4.0, 0.8, ("movement-completion",)),
        CandidateMoment(6.0, 0.9, ("downbeat",)),
        CandidateMoment(8.0, 0.9, ("gesture-apex",)),
    ]
    values = {
        (0.0, 3.0, "a"): 1.0,
        (0.0, 3.0, "b"): 0.8,
        (3.0, 6.0, "a"): -2.0,
        (3.0, 6.0, "b"): -2.0,
        (6.0, 10.0, "a"): 0.7,
        (6.0, 10.0, "b"): 0.8,
        (0.0, 4.0, "a"): 0.9,
        (0.0, 4.0, "b"): 0.7,
        (4.0, 8.0, "a"): 0.9,
        (4.0, 8.0, "b"): 1.1,
        (8.0, 10.0, "a"): 0.8,
        (8.0, 10.0, "b"): 0.7,
    }
    decision = optimize_sequence(
        moments=moments,
        duration_seconds=10.0,
        take_ids=["a", "b"],
        interval_score=lambda start, end, take: values.get((start, end, take), -10.0),
        desired_phrases=3,
        minimum_phrase_seconds=1.0,
        maximum_phrase_seconds=6.0,
    )
    assert [item.time_seconds for item in decision.boundaries] == [4.0, 8.0]
    assert decision.take_ids == ("a", "b", "a")


def test_fixed_beat_grammar_is_not_an_input() -> None:
    moments = [
        CandidateMoment(2.0, 0.2, ("beat",)),
        CandidateMoment(3.5, 1.0, ("gesture-apex", "lyric-boundary")),
        CandidateMoment(6.5, 1.0, ("movement-completion", "downbeat")),
        CandidateMoment(8.0, 0.2, ("beat",)),
    ]
    decision = optimize_sequence(
        moments=moments,
        duration_seconds=10.0,
        take_ids=["a", "b"],
        interval_score=lambda _start, _end, take: 0.6 if take == "a" else 0.59,
        desired_phrases=3,
        minimum_phrase_seconds=1.0,
        maximum_phrase_seconds=6.0,
    )
    assert [item.time_seconds for item in decision.boundaries] == [3.5, 6.5]
