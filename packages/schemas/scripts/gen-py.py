import subprocess, sys
from pathlib import Path

def main():
    here = Path(__file__).parent.parent
    subprocess.run(
        [
            "datamodel-codegen",
            "--input", str(here / "openapi.yaml"),
            "--input-file-type", "openapi",
            "--output", str(here / "python" / "models.py"),
            "--output-model-type", "pydantic_v2.BaseModel",
        ],
        check=True,
    )
    # write __init__.py re-exporting
    init_path = here / "python" / "__init__.py"
    init_path.write_text("from .models import *  # noqa: F401,F403\n")
    print("✓ generated python models at", here / "python" / "models.py")

if __name__ == "__main__":
    main()
