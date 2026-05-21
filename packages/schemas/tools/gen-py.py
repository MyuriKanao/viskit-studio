import subprocess
import sys
from pathlib import Path


def main() -> None:
    here = Path(__file__).parent.parent
    subprocess.run(
        [
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(here / "openapi.yaml"),
            "--input-file-type",
            "openapi",
            "--output",
            str(here / "python" / "models.py"),
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--disable-timestamp",
            "--use-annotated",
            "--set-default-enum-member",
        ],
        check=True,
    )
    model_path = here / "python" / "models.py"
    model_text = model_path.read_text()
    if "# ruff: noqa: E501" not in model_text.splitlines()[:3]:
        model_path.write_text("# ruff: noqa: E501\n" + model_text)

    init_path = here / "python" / "__init__.py"
    init_path.write_text("from .models import *  # noqa: F401,F403\n")
    print("✓ generated python models at", here / "python" / "models.py")


if __name__ == "__main__":
    main()
