STEP_REGISTRY = {}

def register_adapter(name: str, adapter_class):
    """Registers a step adapter class."""
    STEP_REGISTRY[name] = adapter_class

def get_adapter(name: str):
    """Resolves and instantiates an adapter for the given step name."""
    if not STEP_REGISTRY:
        # Force registration by importing adapters package
        from . import adapters
    
    if name not in STEP_REGISTRY:
        raise ValueError(f"No adapter registered for step name: {name}")
    return STEP_REGISTRY[name]()
