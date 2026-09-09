import os
import re
import sys

def migrate_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Replacements
    new_content = content
    # Handle specific variables to ignore? CLAUDE_ is already distinct from SOTERIA.
    # What about github.com/HIMAVARASAGAR/Soteria -> /soteria
    new_content = new_content.replace('Soteria', 'Soteria')
    new_content = new_content.replace('soteria', 'soteria')
    new_content = new_content.replace('SOTERIA', 'SOTERIA')

    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Migrated {filepath}")
    else:
        print(f"No changes in {filepath}")

for arg in sys.argv[1:]:
    if os.path.isdir(arg):
        main(arg)
    else:
        migrate_file(arg)
