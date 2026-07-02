import os
import modal

app = modal.App()

@app.function(secrets=[modal.Secret.from_name("my-api-secrets")])
def f():
    print(os.environ["MODAL_INTERNAL_SECRET"])
