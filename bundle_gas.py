#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bundle index.html, styles.css, gov_hospitals.js, data.js, and app.js into google_apps_script/index.html.
"""

import os
import re

DIR = os.path.dirname(os.path.abspath(__file__))

def main():
    index_path = os.path.join(DIR, 'index.html')
    styles_path = os.path.join(DIR, 'styles.css')
    gov_path = os.path.join(DIR, 'gov_hospitals.js')
    data_path = os.path.join(DIR, 'data.js')
    app_path = os.path.join(DIR, 'app.js')
    target_path = os.path.join(DIR, 'google_apps_script', 'index.html')

    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()
    with open(styles_path, 'r', encoding='utf-8') as f:
        css = f.read()
    with open(gov_path, 'r', encoding='utf-8') as f:
        gov_js = f.read()
    with open(data_path, 'r', encoding='utf-8') as f:
        data_js = f.read()
    with open(app_path, 'r', encoding='utf-8') as f:
        app_js = f.read()

    # Replace stylesheet link with inline <style>
    html = re.sub(r'<link\s+rel=[\'"]stylesheet[\'"]\s+href=[\'"]styles\.css(?:\?v=[^\'"]*)?[\'"]\s*>', f'<style>\n{css}\n</style>', html)

    # Replace bottom scripts with inline <script> tags
    script_bundle = f"""  <!-- Inlined Government Healthcare Facilities DB -->
  <script>
{gov_js}
  </script>
  <!-- Inlined Member & Thaifammed Data Bundle -->
  <script>
{data_js}
  </script>
  <!-- Inlined Dashboard Application Engine -->
  <script>
{app_js}
  </script>"""

    html = re.sub(
        r'<!-- Load Data Bundle and App Logic[^>]*-->\s*<script\s+src=[\'"]gov_hospitals\.js(?:\?v=[^\'"]*)?[\'"]></script>\s*<script\s+src=[\'"]data\.js(?:\?v=[^\'"]*)?[\'"]></script>\s*<script\s+src=[\'"]app\.js(?:\?v=[^\'"]*)?[\'"]></script>',
        lambda m: script_bundle,
        html
    )

    with open(target_path, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"Successfully generated {target_path} ({len(html):,} bytes)")

if __name__ == '__main__':
    main()
