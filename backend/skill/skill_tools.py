"""
Skill tools - LangChain @tool wrappers for the skill framework and base tools.
"""
import os
import sys
import subprocess
from pathlib import Path
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage

from skill import skill_loader

# Resolve the Python executable from the current virtual environment
_PYTHON = sys.executable

# Working directory for base tools (file I/O, bash)
WORK_DIR = Path(os.getenv(
    "SKILL_WORK_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "skill_workspace"),
)).resolve()

# Per-session activated skills tracking
_active_skills: dict[tuple, dict] = {}
# Current session context (set before each agent invocation)
_current_context: dict = {"user_id": "default_user", "session_id": "default_session"}


def set_skill_context(user_id: str, session_id: str):
    """Set the current session context for skill activation tracking."""
    _current_context["user_id"] = user_id
    _current_context["session_id"] = session_id


def get_active_skill_messages(user_id: str, session_id: str) -> list:
    """Return SystemMessage objects for all activated skills in this session."""
    key = (user_id, session_id)
    skills = _active_skills.get(key, {})
    messages = []
    for skill_name, content in skills.items():
        messages.append(SystemMessage(
            content=f"[Activated Skill: {skill_name}]\n\n{content}"
        ))
    return messages


def deactivate_all_skills(user_id: str, session_id: str):
    """Clear activated skills for a session."""
    _active_skills.pop((user_id, session_id), None)


def _resolve(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else (WORK_DIR / p).resolve()


# ---------------------------------------------------------------------------
# Skill activation tool
# ---------------------------------------------------------------------------

@tool("use_skill")
def use_skill(skill_name: str, reason: str = "") -> str:
    """Activate a skill to access its full capabilities. ALWAYS call this FIRST when the user's request matches any skill's domain (e.g. creating ship stiffeners/加强筋, generating STEP models, creating a PPT, designing a poster, building a frontend page).
    Do NOT answer the question directly without activating the matching skill first.
    Available skills are listed in your system instructions."""
    content = skill_loader.activate_skill(skill_name)
    if content is None:
        available = ", ".join(skill_loader.list_skills()) or "none"
        return f"Skill '{skill_name}' not found. Available skills: {available}"

    # Register for the current session
    user_id = _current_context["user_id"]
    session_id = _current_context["session_id"]
    key = (user_id, session_id)
    if key not in _active_skills:
        _active_skills[key] = {}
    _active_skills[key][skill_name] = content

    return (
        f"Skill '{skill_name}' activated. Follow its instructions precisely. "
        f"You now have access to read_file, write_file, list_files, create_directory, and execute_bash tools."
    )


# ---------------------------------------------------------------------------
# Base tools (file I/O + bash)
# ---------------------------------------------------------------------------

@tool
def read_file(path: str) -> str:
    """Read the contents of a text file."""
    file_path = _resolve(path)
    if not file_path.exists():
        return f"Error: File not found: {path}"
    if not file_path.is_file():
        return f"Error: Not a file: {path}"
    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"Binary file ({file_path.stat().st_size} bytes)."


@tool
def write_file(path: str, content: str) -> str:
    """Write content to a file. Creates parent directories if needed."""
    file_path = _resolve(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    return f"Successfully wrote to: {path}"


@tool
def list_files(path: str = ".") -> str:
    """List files and directories in a directory."""
    dir_path = _resolve(path)
    if not dir_path.exists():
        return f"Error: Directory not found: {path}"
    if not dir_path.is_dir():
        return f"Error: Not a directory: {path}"
    items = []
    for item in sorted(dir_path.iterdir()):
        if item.is_dir():
            items.append(f"[DIR]  {item.name}/")
        else:
            items.append(f"[FILE] {item.name} ({item.stat().st_size} bytes)")
    return "\n".join(items) if items else "(empty)"


@tool
def create_directory(path: str) -> str:
    """Create a directory and any necessary parent directories."""
    dir_path = _resolve(path)
    dir_path.mkdir(parents=True, exist_ok=True)
    return f"Created directory: {path}"


@tool
def execute_bash(command: str) -> str:
    """Execute a bash/shell command and return output. Use for running scripts, python, pip, etc.
    When running Python scripts, the project's virtual environment Python is used automatically."""
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    # Replace bare 'python' with the venv Python to ensure dependencies are available
    import re
    python_escaped = _PYTHON.replace("\\", "\\\\")
    command = re.sub(r'^python\b', python_escaped, command)
    command = re.sub(r'(?<=\s)python\b', python_escaped, command)
    try:
        result = subprocess.run(
            command, shell=True, cwd=str(WORK_DIR),
            capture_output=True, text=True, timeout=120,
        )
        parts = []
        if result.stdout:
            parts.append(f"STDOUT:\n{result.stdout}")
        if result.stderr:
            parts.append(f"STDERR:\n{result.stderr}")
        parts.append(f"Return code: {result.returncode}")
        return "\n\n".join(parts)
    except subprocess.TimeoutExpired:
        return "Error: Command timed out (120 second limit)"
    except Exception as e:
        return f"Error: {str(e)}"


# ---------------------------------------------------------------------------
# Collected tool list for agent registration
# ---------------------------------------------------------------------------

def get_skill_tools() -> list:
    """All skill-related LangChain tools."""
    return [use_skill, read_file, write_file, list_files, create_directory, execute_bash]
