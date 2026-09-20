#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Local server for Medical Member Dashboard with built-in image proxy.
Zero external API key required.
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import ssl
import os
import sys

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

ssl_ctx = ssl._create_unverified_context()

class DashboardRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        # Built-in image proxy for Google Drive photos
        if self.path.startswith('/api/proxy-image'):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            drive_id = query.get('id', [''])[0]
            if not drive_id:
                self.send_error(400, "Missing id parameter")
                return

            candidate_urls = [
                f"https://lh3.googleusercontent.com/d/{drive_id}=w500",
                f"https://drive.google.com/thumbnail?id={drive_id}&sz=w500",
                f"https://wsrv.nl/?url=https://drive.google.com/uc?id={drive_id}"
            ]

            img_data = None
            content_type = "image/jpeg"

            for u in candidate_urls:
                try:
                    req = urllib.request.Request(
                        u,
                        headers={
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                        }
                    )
                    with urllib.request.urlopen(req, context=ssl_ctx, timeout=6) as resp:
                        if resp.status == 200:
                            img_data = resp.read()
                            content_type = resp.headers.get('Content-Type', 'image/jpeg')
                            break
                except Exception:
                    continue

            if img_data:
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(img_data)))
                self.send_header('Cache-Control', 'public, max-age=86400')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(img_data)
                return
            else:
                self.send_error(404, "Image could not be retrieved")
                return

        return super().do_GET()

def start_server():
    os.chdir(DIRECTORY)
    port = PORT
    max_attempts = 10
    httpd = None

    socketserver.TCPServer.allow_reuse_address = True
    for i in range(max_attempts):
        try:
            httpd = socketserver.TCPServer(("", port), DashboardRequestHandler)
            break
        except OSError:
            port += 1

    if not httpd:
        print(f"Could not bind to any port starting from {PORT}")
        sys.exit(1)

    url = f"http://localhost:{port}"
    print("\n" + "=" * 60)
    print(f"🏥 Medical Member Interactive Dashboard is running!")
    print(f"🌐 Access Dashboard at: {url}")
    print(f"🗺️ Map: OpenStreetMap & ESRI (No API Key Required)")
    print(f"🖼️ Images: Multi-Tier CDN & Built-in Proxy Active")
    print("=" * 60 + "\n")
    print("Press Ctrl+C to stop the server.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == '__main__':
    start_server()
