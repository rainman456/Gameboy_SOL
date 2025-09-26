import os
import uuid
from pathlib import Path
from datetime import datetime
import mimetypes
import argparse
import sys

OUTPUT_FILE = "code.md"

# Extended ignore directories and files
IGNORE_DIRS = {
    ".anchor",
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".idea",
    ".vscode",
    "venv",
    "dist",
    "build",
    "test-ledger",
   
}
IGNORE_FILES = {
    ".DS_Store",
    "Thumbs.db",
    ".gitignore",
    ".prettierignore",
    "cargo.bak",
    "Cargo.lock",
   # "tsconfig.json",
    "yarn.lock",
    "README.md",
    "Dockerfile",
    "parse.py",
    "Dockerfile",
    "package-lock.json",
    "go.sum",
    "go.mod",
    "swagger.yaml",
    "internal.md",
    "setup.sh",
    "start-validator.sh"
}


def generate_tree(root: Path, prefix="", depth=0, max_depth=5):
    """Generate a tree-like structure for the given folder, skipping ignored dirs."""
    if depth > max_depth:
        return [prefix + "└── ... (max depth reached)"]

    entries = sorted(
        [
            e
            for e in root.iterdir()
            if e.name not in IGNORE_DIRS and e.name not in IGNORE_FILES
        ],
        key=lambda e: (e.is_file(), e.name.lower()),
    )
    result = []
    for i, entry in enumerate(entries):
        connector = "└── " if i == len(entries) - 1 else "├── "
        result.append(f"{prefix}{connector}{entry.name}{'/' if entry.is_dir() else ''}")
        if entry.is_dir():
            extension = "    " if i == len(entries) - 1 else "│   "
            result.extend(
                generate_tree(entry, prefix + extension, depth + 1, max_depth)
            )
    return result


def detect_content_type(file_path: Path):
    """Enhanced content type detection using both extension and mimetypes."""
    extension_mapping = {
        ".rs": "text/rust",
        ".go": "text/go",
        ".py": "text/python",
        ".js": "text/javascript",
        ".ts": "text/typescript",
        ".java": "text/java",
        ".c": "text/c",
        ".cpp": "text/cpp",
        ".cs": "text/csharp",
        ".rb": "text/ruby",
        ".php": "text/php",
        ".html": "text/html",
        ".css": "text/css",
        ".scss": "text/x-scss",
        ".toml": "text/toml",
        ".json": "application/json",
        ".md": "text/markdown",
        ".txt": "text/plain",
        ".sh": "text/x-shellscript",
        ".yml": "text/yaml",
        ".yaml": "text/yaml",
        ".sql": "text/sql",
        ".xml": "text/xml",
        ".dockerfile": "text/x-dockerfile",
        ".ipynb": "application/x-ipynb+json",
    }

    content_type = extension_mapping.get(file_path.suffix.lower())
    if content_type:
        return content_type

    mime_type, _ = mimetypes.guess_type(file_path)
    return mime_type or "text/plain"


def get_file_stats(file_path: Path):
    """Get file statistics including size and modification time."""
    try:
        stats = file_path.stat()
        return {
            "size": f"{stats.st_size / 1024:.2f} KB",
            "modified": datetime.fromtimestamp(stats.st_mtime).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            "lines": sum(1 for _ in file_path.open(encoding="utf-8", errors="ignore")),
        }
    except Exception:
        return None


def parse_codebase(root_folder: str, output_file: str = OUTPUT_FILE):
    """Parse codebase and generate markdown with xaiArtifact tags."""
    try:
        root = Path(root_folder).resolve()
        if not root.exists():
            raise FileNotFoundError(f"Folder not found: {root_folder}")
        if not root.is_dir():
            raise NotADirectoryError(f"Path is not a directory: {root_folder}")

        # Generate tree structure
        tree_lines = [f"📁 {root.name}"] + generate_tree(root)
        tree_structure = f"```tree\n{chr(10).join(tree_lines)}\n```"

        # Initialize markdown parts
        md_parts = [
            f"# Codebase Analysis: {root.name}\n",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n",
            "---\n\n## 📂 Project Structure\n",
            tree_structure,
            "\n---\n\n## 📄 File Contents\n",
        ]

        file_count = 0
        total_size = 0
        file_types = set()

        # Walk through all files
        for file_path in root.rglob("*"):
            if any(
                part in IGNORE_DIRS or part in IGNORE_FILES for part in file_path.parts
            ):
                continue

            if file_path.is_file():
                try:
                    content = file_path.read_text(encoding="utf-8", errors="ignore")
                    content_type = detect_content_type(file_path)
                    file_stats = get_file_stats(file_path)

                    file_count += 1
                    file_types.add(file_path.suffix)
                    if file_stats:
                        total_size += float(file_stats["size"].split()[0])

                    artifact_id = str(uuid.uuid4())
                    artifact_version_id = str(uuid.uuid4())
                    relative_path = file_path.relative_to(root)

                    file_info = f"### {relative_path}\n"
                    if file_stats:
                        file_info += f"- Size: {file_stats['size']}\n"
                        file_info += f"- Lines: {file_stats['lines']}\n"
                        file_info += f"- Last Modified: {file_stats['modified']}\n"

                    md_parts.append(
                        f"{file_info}\n"
                        f'<xaiArtifact artifact_id="{artifact_id}" '
                        f'artifact_version_id="{artifact_version_id}" '
                        f'title="{relative_path}" '
                        f'contentType="{content_type}">\n'
                        f"```{content_type.split('/')[-1] or file_path.suffix.lstrip('.')}\n"
                        f"{content}\n"
                        f"```\n"
                        f"</xaiArtifact>\n\n---\n"
                    )
                except Exception as e:
                    print(f"⚠️ Skipping file {file_path}: {e}", file=sys.stderr)

        # Add summary
        summary = [
            "\n---\n## 📊 Summary\n",
            f"- Total files: {file_count}\n",
            f"- Total size: {total_size:.2f} KB\n",
            f"- File types: {', '.join(sorted(ft or 'unknown' for ft in file_types))}\n",
        ]
        md_parts.extend(summary)

        # Write final markdown
        output_path = Path(output_file)
        output_path.write_text("".join(md_parts), encoding="utf-8")
        print(f"✅ Codebase exported to {output_path.resolve()}")

    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Export codebase to Markdown with <xaiArtifact> tags"
    )
    parser.add_argument("folder", help="Path to the codebase folder")
    parser.add_argument(
        "-o", "--output", default=OUTPUT_FILE, help="Output markdown file name"
    )
    args = parser.parse_args()
    parse_codebase(args.folder, args.output)
