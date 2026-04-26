"""
Skill Loader - Progressive L1/L2/L3 loading of SKILL.md files.
"""
import os
import logging
import yaml
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class SkillLoader:
    """Discovers and loads skills following the SKILL.md format."""

    def __init__(self, skills_directory: str):
        self.skills_directory = Path(skills_directory)
        # L1: metadata only (name, description)
        self.skill_metadata: Dict[str, Dict[str, str]] = {}
        # L2: full SKILL.md content
        self.skill_content: Dict[str, str] = {}
        # L3: auxiliary resources
        self.skill_resources: Dict[str, Dict[str, str]] = {}

        if not self.skills_directory.exists():
            logger.warning("Skills directory not found: %s", skills_directory)

    def discover_skills(self) -> Dict[str, Dict[str, str]]:
        """L1: Discover skills and load only name + description."""
        if not self.skills_directory.exists():
            logger.warning("Skills directory not found: %s", self.skills_directory)
            return {}

        skill_folders = [
            item for item in self.skills_directory.iterdir()
            if item.is_dir() and (item / "SKILL.md").exists()
        ]

        for skill_folder in skill_folders:
            try:
                metadata = self._load_skill_metadata(skill_folder)
                if metadata:
                    self.skill_metadata[metadata["name"]] = metadata
                    logger.info("Discovered skill: %s", metadata["name"])
            except Exception as e:
                logger.warning("Failed to load skill %s: %s", skill_folder.name, e)

        logger.info("Total skills discovered: %d", len(self.skill_metadata))
        return self.skill_metadata

    def _load_skill_metadata(self, skill_folder: Path) -> Optional[Dict[str, str]]:
        """Read only the YAML frontmatter from a SKILL.md."""
        skill_file = skill_folder / "SKILL.md"
        content = skill_file.read_text(encoding="utf-8")

        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 2:
                frontmatter = yaml.safe_load(parts[1])
                if frontmatter:
                    return {
                        "name": frontmatter.get("name", skill_folder.name),
                        "description": frontmatter.get("description", ""),
                        "path": str(skill_folder),
                        "license": frontmatter.get("license", ""),
                    }
        return None

    def activate_skill(self, skill_name: str) -> Optional[str]:
        """L2: Load full SKILL.md content."""
        if skill_name not in self.skill_metadata:
            logger.warning("Skill not found: %s", skill_name)
            return None

        if skill_name in self.skill_content:
            return self.skill_content[skill_name]

        skill_path = Path(self.skill_metadata[skill_name]["path"])
        skill_file = skill_path / "SKILL.md"

        try:
            content = skill_file.read_text(encoding="utf-8")
            self.skill_content[skill_name] = content
            logger.info("Activated skill (L2): %s", skill_name)
            return content
        except Exception as e:
            logger.error("Failed to activate skill %s: %s", skill_name, e)
            return None

    def load_resource(self, skill_name: str, resource_path: str) -> Optional[str]:
        """L3: Load a supporting file from a skill folder."""
        if skill_name not in self.skill_metadata:
            return None

        skill_path = Path(self.skill_metadata[skill_name]["path"])
        resource_file = skill_path / resource_path

        if not resource_file.exists():
            return None

        if skill_name not in self.skill_resources:
            self.skill_resources[skill_name] = {}
        if resource_path in self.skill_resources[skill_name]:
            return self.skill_resources[skill_name][resource_path]

        try:
            content = resource_file.read_text(encoding="utf-8")
            self.skill_resources[skill_name][resource_path] = content
            return content
        except Exception:
            return None

    def list_skills(self) -> list[str]:
        return list(self.skill_metadata.keys())

    def get_skill_description(self, skill_name: str) -> Optional[str]:
        if skill_name in self.skill_metadata:
            return self.skill_metadata[skill_name]["description"]
        return None

    def get_skill_catalog_description(self) -> str:
        """Format L1 metadata as a concise string for system prompt injection."""
        if not self.skill_metadata:
            return ""

        lines = [
            "",
            "## Available Skills",
            "",
            "You can activate a skill by calling the `use_skill` tool. "
            "Available skills:",
            "",
        ]
        for skill_name, meta in self.skill_metadata.items():
            desc = meta.get("description", "")
            if len(desc) > 120:
                desc = desc[:117] + "..."
            lines.append(f"- **{skill_name}**: {desc}")
        return "\n".join(lines)
