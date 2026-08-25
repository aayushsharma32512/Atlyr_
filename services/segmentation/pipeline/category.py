"""
Garment category resolution for the green-screen pipeline.

Deliberately dependency-free (no cv2/torch/numpy) so the decision logic can be unit-tested
without a GPU or a parser — see test_category.py.

── Why this exists ──

The caller already knows the garment type: it is an operator-supplied enum on the submit route
(services/ingestion-automated/src/api/routes/submit.ts), not a model output, and it is passed
through to Modal as ?category=. The pipeline used to discard it and re-derive the category from
"whichever FASHN garment class covers the most pixels".

That vote breaks on low-coverage garments. On a bikini, bralette or corset top the try-on avatar
is otherwise bare, the parser reads the exposed pelvis as `pants`, and that region out-areas the
tiny top — so the category resolves to `pants` and every downstream step (garment classes,
exclusion classes, the v-neck skin punch) targets the hips. The output is a skin-toned blob.
Measured over 400 recent jobs: 16 of 317 topwear jobs (5.0%) resolved to `pants`.

── The rule ──

The caller's category LIMITS the candidates; the same area vote then picks within them. It is
not a hard override, because a long top legitimately parses as `dress` and segments correctly
that way — 39 of those 317 jobs — so `dress` stays a candidate for topwear.

── Why this cannot disturb a job that works today ──

Constraining can only change the outcome when the unconstrained winner lies OUTSIDE the allowed
set. If it is inside, it still holds the largest area among the allowed candidates, so it still
wins and the resolution is identical. Over those same 400 jobs only 17 winners fall outside
(16 topwear->pants, 1 bottomwear->dress) — exactly the failing ones.
"""

# Candidates permitted for each category the caller may request. First entry is the natural
# reading; the second is the parse that is also legitimate for that garment type.
CATEGORY_CANDIDATES = {
    "top": ["top", "dress"],
    "dress": ["dress", "top"],
    "pants": ["pants", "skirt"],
    "skirt": ["skirt", "pants"],
    "footwear": ["footwear"],
}

# The ingestion service sends 'bottom' (segmenting.handler.ts), but every class dict in the
# pipeline is keyed 'pants'. Without this alias `FASHN_GARMENT_CLASSES.get('bottom', [3])`
# silently falls back to the TOP classes and every bottomwear job segments the wrong region.
CATEGORY_ALIASES = {
    "bottom": "pants",
    "bottomwear": "pants",
    "bottoms": "pants",
    "topwear": "top",
    "tops": "top",
    "dresses": "dress",
    "shoes": "footwear",
}


# Categories whose try-on frame leaves the torso bare, so skin ABOVE the garment has to be removed.
# Deliberately excludes top/dress: there the torso is covered by the garment itself, and their
# necklines are already handled by the head/neck-gated punch in core_segmentation.
BOTTOMWEAR_CATEGORIES = ("pants", "skirt")


def should_remove_bare_torso(category, is_garment_skin_colored, is_green_screen):
    """
    Whether to subtract colour-detected skin lying outside the garment.

    The colour skin rule is normally switched off when the garment itself reads as skin, because it
    cannot then tell garment from mannequin. That is right for topwear, but on bottomwear it also
    throws away the only signal that removes the bare midriff — the parser has no bare-torso class,
    so nothing else covers it, and SAM2 keeps it as a detached blob above the waistband.

    Narrow by design. All three conditions must hold:
      · bottomwear      — top/dress keep their existing path byte for byte
      · skin-hued       — a normal-hued garment already has the rule running and never blobs
      · not green screen — on green input the garment is not protected by its own mask subtraction
    """
    key = (category or "").strip().lower()
    key = CATEGORY_ALIASES.get(key, key)
    return (
        key in BOTTOMWEAR_CATEGORIES
        and bool(is_garment_skin_colored)
        and not bool(is_green_screen)
    )


def resolve_category(requested, areas):
    """
    Pick the garment category.

    `requested` is what the caller asked for (may be None/unknown); `areas` maps garment
    category -> pixel area measured from the parser's segmentation map.

    Returns (category, debug). `debug` records what an unconstrained vote would have picked and
    which branch was taken, so a deployed run is auditable from the step metadata.
    """

    def argmax(candidates):
        best_cat, best_area = None, 0
        for cat in candidates:
            area = areas.get(cat, 0)
            if area > best_area:
                best_cat, best_area = cat, area
        return best_cat

    # What this step did before the constraint existed — kept as the fallback, and always
    # recorded so "how many jobs did this actually change" is a query, not a guess.
    unconstrained = argmax(areas.keys())

    key = (requested or "").strip().lower()
    key = CATEGORY_ALIASES.get(key, key)
    candidates = CATEGORY_CANDIDATES.get(key)

    def out(category, source):
        return (category or "top"), {
            "category_source": source,
            "category_requested": requested,
            "category_unconstrained": unconstrained,
        }

    if not candidates:
        # Unknown or missing category from the caller — behave exactly as before.
        return out(unconstrained, "unconstrained_unknown_request")

    resolved = argmax(candidates)
    if not resolved:
        # The requested category has no pixels at all. Never trade a working parse for an empty
        # mask: fall back to the unconstrained vote.
        return out(unconstrained, "fallback_no_pixels")

    return out(resolved, "constrained")
