#!/usr/bin/env python3
"""Loopback-only, memory-only converter. Never writes uploaded artwork to disk."""
import argparse
import base64
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from converter import convert_file, MAX_UPLOAD

ROOT=Path(__file__).resolve().parent
TOKEN=secrets.token_urlsafe(32)
SLOTS=threading.BoundedSemaphore(2)

def convert_request(request):
    image=base64.b64decode(request['image'],validate=True)
    options=dict(request.get('options',{}))
    requested=int(options.get('gameLimit',511))
    limit=requested if requested in (128,255,511,1000) else 1000
    options['budget']=min(limit,int(options.get('budget',511)))
    result=convert_file(image,str(request.get('name','')),request.get('frame',0),options)
    result['compatible']=result['shapes']<=limit
    result['gameCompatible']=result['shapes']<= (128 if limit==128 else 255)
    return result

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def allowed(self):
        return self.headers.get('Host') in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
    def send(self,status,data,kind='application/json'):
        if not isinstance(data,bytes): data=json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if not self.allowed(): return self.send(403,{'error':'Local access only.'})
        files={'/':('index.html','text/html; charset=utf-8'),'/app.js':('app.js','text/javascript; charset=utf-8'),'/style.css':('style.css','text/css; charset=utf-8')}
        item=files.get(urlsplit(self.path).path)
        if not item: return self.send(404,{'error':'Not found.'})
        data=(ROOT/item[0]).read_bytes().replace(b'__LOCAL_TOKEN__',TOKEN.encode())
        self.send(200,data,item[1])
    def do_POST(self):
        if not self.allowed() or self.headers.get('X-Local-Token')!=TOKEN:
            return self.send(403,{'error':'Reload the local converter page.'})
        origin=self.headers.get('Origin')
        if origin and origin not in {f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}:
            return self.send(403,{'error':'Local requests only.'})
        if self.path!='/api/convert': return self.send(404,{'error':'Not found.'})
        if not SLOTS.acquire(blocking=False): return self.send(429,{'error':'A conversion is already running. Try again in a moment.'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<=0 or length>MAX_UPLOAD*4//3+65536: raise ValueError('Choose an image smaller than 40 MB.')
            request=json.loads(self.rfile.read(length))
            result=convert_request(request)
            self.send(200,result)
        except Exception as exc:
            # Decoder errors are useful; no stack, local paths, or source bytes returned.
            message=str(exc) if isinstance(exc,(ValueError,KeyError)) else 'Could not decode this file. Try PNG or TIFF, or another frame.'
            self.send(400,{'error':message[:300]})
        finally: SLOTS.release()

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=4381)
    parser.add_argument('--open',action='store_true')
    args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Skin Converter on Crack is ready: http://127.0.0.1:{server.server_port}',flush=True)
    print('Images stay on this computer. Ctrl+C stops the converter.',flush=True)
    if args.open:
        import webbrowser
        webbrowser.open(f'http://127.0.0.1:{server.server_port}')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__=='__main__': main()
