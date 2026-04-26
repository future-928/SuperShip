"""
Skill framework package.
"""
import os
import logging

from .skill_loader import SkillLoader

logger = logging.getLogger(__name__)

SKILLS_DIR = os.getenv(
    "SKILLS_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "skills"),
)
SKILLS_DIR = os.path.abspath(SKILLS_DIR)

skill_loader = SkillLoader(SKILLS_DIR)
skill_loader.discover_skills()
