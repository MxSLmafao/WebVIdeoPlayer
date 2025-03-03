#!/usr/bin/env python3
import http.server
import socketserver
import os
import argparse

def serve_static(port, directory):
    # Change the working directory to the specified directory.
    os.chdir(directory)
    handler = http.server.SimpleHTTPRequestHandler

    # Create the HTTP server.
    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"Serving static files from '{directory}' at http://localhost:{port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down the server.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="A simple static file server similar to GitHub Pages."
    )
    parser.add_argument(
        "--port", type=int, default=8000,
        help="Port to serve on (default: 8000)"
    )
    parser.add_argument(
        "--directory", type=str, default=".",
        help="Directory of static files to serve (default: current directory)"
    )
    args = parser.parse_args()
    serve_static(args.port, args.directory)