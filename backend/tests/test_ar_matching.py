import math

import pytest

from app.ar_matching.similarity import (
    catalog_fit,
    cosine_similarity,
    nearest_reference_similarity,
    normalized_centroid,
)


def test_cosine_similarity_matches_hand_calculation() -> None:
    assert cosine_similarity((1, 2), (3, 4)) == pytest.approx(11 / (math.sqrt(5) * 5))


def test_cosine_similarity_supports_orthogonal_and_negative_vectors() -> None:
    assert cosine_similarity((1, 0), (0, 1)) == pytest.approx(0)
    assert cosine_similarity((1, 0), (-1, 0)) == pytest.approx(-1)


def test_cosine_similarity_is_scale_safe_for_huge_parallel_directions() -> None:
    huge = 1.7e308

    assert cosine_similarity((huge, huge), (huge, huge)) == pytest.approx(1)
    assert cosine_similarity((huge, huge), (1, 1)) == pytest.approx(1)
    assert cosine_similarity((huge, huge), (-huge, -huge)) == pytest.approx(-1)
    assert cosine_similarity((huge, huge), (huge, -huge)) == pytest.approx(0)


def test_cosine_similarity_preserves_tiny_nonzero_directions() -> None:
    subnormal = 5e-324
    tiny = 1e-320

    assert cosine_similarity((subnormal, subnormal), (subnormal, subnormal)) == pytest.approx(1)
    assert cosine_similarity((subnormal, subnormal), (tiny, tiny)) == pytest.approx(1)


@pytest.mark.parametrize(
    "left, right",
    [
        ((), (1,)),
        ((0, 0), (1, 0)),
        ((1, math.inf), (1, 0)),
        ((1, math.nan), (1, 0)),
        ((1, 0), (1,)),
        (((1, 0), (0, 1)), (1, 0)),
        ((1, "not a number"), (1, 0)),
    ],
)
def test_cosine_similarity_rejects_invalid_vectors(left: object, right: object) -> None:
    with pytest.raises(ValueError):
        cosine_similarity(left, right)  # type: ignore[arg-type]


def test_normalized_centroid_gives_each_input_equal_directional_weight() -> None:
    centroid = normalized_centroid(((100, 0), (0, 1)))
    expected_component = 1 / math.sqrt(2)

    assert centroid == pytest.approx((expected_component, expected_component))
    assert math.hypot(*centroid) == pytest.approx(1)


def test_normalized_centroid_is_invariant_to_huge_and_tiny_scales() -> None:
    huge = 1.7e308
    subnormal = 5e-324
    expected = normalized_centroid(((1, 1),))

    assert normalized_centroid(((huge, huge),)) == pytest.approx(expected)
    assert normalized_centroid(((subnormal, subnormal),)) == pytest.approx(expected)
    assert normalized_centroid(((1e-320, 1e-320),)) == pytest.approx(expected)


def test_normalized_centroid_preserves_cancellation_tolerance() -> None:
    with pytest.raises(ValueError, match="cancelled"):
        normalized_centroid(((1, 0), (-1, 1e-13)))

    near_cancellation_above_tolerance = normalized_centroid(((1, 0), (-1, 1e-10)))
    assert near_cancellation_above_tolerance == pytest.approx((0, 1))


@pytest.mark.parametrize(
    "vectors",
    [
        (),
        ((0, 0), (1, 0)),
        ((1, 0), (-1, 0)),
        ((1, math.inf), (0, 1)),
        ((1, 0), (1,)),
        (((1, 0), (0, 1)), (1, 0)),
    ],
)
def test_normalized_centroid_rejects_undefined_or_invalid_vectors(vectors: object) -> None:
    with pytest.raises(ValueError):
        normalized_centroid(vectors)  # type: ignore[arg-type]


def test_nearest_reference_similarity_uses_available_references_when_fewer_than_k() -> None:
    # Similarities are 0 and -1, so both available references average to -0.5.
    assert nearest_reference_similarity((1, 0), ((0, 1), (-1, 0))) == pytest.approx(-0.5)


def test_nearest_reference_similarity_averages_only_the_top_k() -> None:
    references = ((0, 1), (-1, 0), (1, 0))
    assert nearest_reference_similarity((1, 0), references, k=2) == pytest.approx(0.5)


def test_nearest_reference_similarity_rejects_empty_or_mismatched_references() -> None:
    with pytest.raises(ValueError, match="at least one reference"):
        nearest_reference_similarity((1, 0), ())
    with pytest.raises(ValueError, match="dimension"):
        nearest_reference_similarity((1, 0), ((1, 0), (1,)))


@pytest.mark.parametrize("k", [0, -1, 1.5, True])
def test_nearest_reference_similarity_rejects_invalid_k(k: object) -> None:
    with pytest.raises(ValueError, match="positive integer"):
        nearest_reference_similarity((1, 0), ((1, 0),), k=k)  # type: ignore[arg-type]


def test_catalog_fit_combines_centroid_and_nearest_similarity() -> None:
    # Centroid cosine is 1/sqrt(2); nearest mean is (1 + 0) / 2.
    fit = catalog_fit((1, 0), ((1, 0), (0, 1)))
    expected = 0.40 / math.sqrt(2) + 0.60 * 0.5

    assert fit == pytest.approx(expected)


def test_catalog_fit_is_invariant_to_huge_and_tiny_vector_scales() -> None:
    huge = 1.7e308
    subnormal = 5e-324
    expected = catalog_fit((1, 1), ((1, 0), (0, 1)))

    huge_fit = catalog_fit((huge, huge), ((huge, 0), (0, huge)))
    tiny_fit = catalog_fit((subnormal, subnormal), ((subnormal, 0), (0, subnormal)))

    assert huge_fit == pytest.approx(expected)
    assert tiny_fit == pytest.approx(expected)


def test_catalog_fit_accepts_configured_weights_within_sum_tolerance() -> None:
    fit = catalog_fit(
        (1, 0),
        ((1, 0), (0, 1)),
        centroid_weight=0.25,
        nearest_weight=0.75,
    )
    assert fit == pytest.approx(0.25 / math.sqrt(2) + 0.75 * 0.5)

    tolerated_fit = catalog_fit(
        (1, 0),
        ((1, 0),),
        centroid_weight=0.4,
        nearest_weight=0.6000000005,
    )
    assert tolerated_fit == pytest.approx(1.0000000005)


def test_catalog_fit_accepts_one_shot_vector_iterables() -> None:
    query = iter((1, 0))
    references = (iter((1, 0)), iter((0, 1)))

    assert catalog_fit(query, references) == pytest.approx(0.40 / math.sqrt(2) + 0.60 * 0.5)


@pytest.mark.parametrize(
    "centroid_weight, nearest_weight",
    [
        (-0.1, 1.1),
        (math.nan, 0.6),
        (0.4, math.inf),
        (0.4, 0.5),
        (0.4, 0.600000002),
    ],
)
def test_catalog_fit_rejects_invalid_weights(
    centroid_weight: object, nearest_weight: object
) -> None:
    with pytest.raises(ValueError, match="weights"):
        catalog_fit(
            (1, 0),
            ((1, 0),),
            centroid_weight=centroid_weight,  # type: ignore[arg-type]
            nearest_weight=nearest_weight,  # type: ignore[arg-type]
        )
