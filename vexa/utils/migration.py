"""
migration.py — Handles Vexa to Vexa data migration.
"""

import os
import shutil
import logging
from pathlib import Path

logger = logging.getLogger("vexa.migration")

OLD_CONFIG_DIR = Path.home() / ".codesage"
NEW_CONFIG_DIR = Path.home() / ".vexa"

def migrate_if_needed():
    """
    Checks if .codesage exists and copies data to .vexa if the new config
    is missing or incomplete.
    """
    # If the old directory exists
    if OLD_CONFIG_DIR.exists():
        # Check if new directory is missing or lacks core config files
        config_exists = (NEW_CONFIG_DIR / "config.json").exists()
        auth_exists   = (NEW_CONFIG_DIR / "account.json").exists()
        
        if not NEW_CONFIG_DIR.exists() or (not config_exists and not auth_exists):
            try:
                # Merge if NEW_CONFIG_DIR exists, or copy if not
                if NEW_CONFIG_DIR.exists():
                    # Manual copy of files to avoid overwriting newer data if any
                    for item in OLD_CONFIG_DIR.iterdir():
                        dest = NEW_CONFIG_DIR / item.name
                        if not dest.exists():
                            if item.is_dir():
                                shutil.copytree(item, dest)
                            else:
                                shutil.copy(item, dest)
                else:
                    shutil.copytree(OLD_CONFIG_DIR, NEW_CONFIG_DIR)
                
                logger.info(f"Successfully migrated data from {OLD_CONFIG_DIR} to {NEW_CONFIG_DIR}")
            except Exception as e:
                logger.error(f"Migration failed: {e}")
    
    # Always ensure the new dir exists
    NEW_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
