"""
migration.py — Handles CSage to CSage data migration.
"""

import os
import shutil
import logging
from pathlib import Path

logger = logging.getLogger("csage.migration")

OLD_SOURCES = [Path.home() / ".vexa", Path.home() / ".codesage"]
NEW_CONFIG_DIR = Path.home() / ".csage"

def migrate_if_needed():
    """
    Checks if old configuration directories exist and copies data to .csage 
    if the new config is missing or incomplete. Priorities .vexa over .codesage.
    """
    for old_dir in OLD_SOURCES:
        if old_dir.exists():
            # Check if new directory is missing or lacks core config files
            config_exists = (NEW_CONFIG_DIR / "config.json").exists()
            auth_exists   = (NEW_CONFIG_DIR / "auth.json").exists()
            
            if not NEW_CONFIG_DIR.exists() or (not config_exists and not auth_exists):
                try:
                    # Merge if NEW_CONFIG_DIR exists, or copy if not
                    if NEW_CONFIG_DIR.exists():
                        # Manual copy of files to avoid overwriting newer data if any
                        for item in old_dir.iterdir():
                            dest = NEW_CONFIG_DIR / item.name
                            if not dest.exists():
                                if item.is_dir():
                                    shutil.copytree(item, dest)
                                else:
                                    shutil.copy(item, dest)
                    else:
                        shutil.copytree(old_dir, NEW_CONFIG_DIR)
                    
                    logger.info(f"Successfully migrated data from {old_dir} to {NEW_CONFIG_DIR}")
                except Exception as e:
                    logger.error(f"Migration failed from {old_dir}: {e}")
    
    # Always ensure the new dir exists
    NEW_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
