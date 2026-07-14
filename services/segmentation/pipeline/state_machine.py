from typing import List, Dict, Any

# Maps current state/pipeline stage to the next automatic state
TRANSITIONS = {
    'pending':            'running_round1',
    'running_round1':     'running_sam_v2',
    'running_sam_v2':     'running_refinement',
    'running_refinement': 'running_round2',
    'running_round2':     'combining',
    'combining':          'completed',
}

# Ordered steps and their execution groups
STEP_ORDER = [
    {'state': 'running_round1',     'steps': ['fashn_seg', 'schp_seg', 'gdino'], 'parallel': True},
    {'state': 'running_sam_v2',     'steps': ['sam_v2'],                          'parallel': False},
    {'state': 'running_refinement', 'steps': ['fashn_seg_refine'],                'parallel': False},
    {'state': 'running_round2',     'steps': ['vitmatte', 'birefnet'],            'parallel': True},
    {'state': 'combining',          'steps': ['combine'],                         'parallel': False},
]

def next_state(current_state: str) -> str:
    """Returns the next state in the state machine transition table."""
    if current_state not in TRANSITIONS:
        raise ValueError(f"No transition defined for state: {current_state}")
    return TRANSITIONS[current_state]

def get_steps_for_state(state: str) -> dict:
    """Returns the step configuration (steps list and parallel flag) for a given state."""
    for item in STEP_ORDER:
        if item['state'] == state:
            return item
    return {}

def is_terminal(state: str) -> bool:
    """Checks if a state is terminal (no more transitions)."""
    return state in ['completed', 'failed', 'cancelled']
