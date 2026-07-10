"""
proxy_server.py
===============
同时提供两部分：
1) 静态文件服务（相当于 python -m http.server 8080）
2) /api/supabase/* 的反向代理，把请求原样转发到 SUPABASE_URL（例如
   https://rkmspodctprrwmeiteos.supabase.co/*）并把响应原样写回。
这样前端 fetch 只访问同源的 http://localhost:8080/api/supabase/...，
绕过了 CORS / sandbox / preview iframe 限制。

使用方法：
    # 设置环境变量（或直接改下面的 SUPABASE_URL）
    export SUPABASE_URL="https://rkmspodctprrwmeiteos.supabase.co"
    # 启动
    python3 proxy_server.py 8080
    # 在浏览器里打开 http://localhost:8080/signup.html
"""

import http.server
import socketserver
import os
import ssl
import sys
import urllib.request
import urllib.parse
import urllib.error

# ----- 配置 -----
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
SUPABASE_URL = os.environ.get(
    "SUPABASE_URL",
    "https://rkmspodctprrwmeiteos.supabase.co",
).rstrip("/")
PROXY_PREFIX = "/api/supabase"


class Handler(http.server.SimpleHTTPRequestHandler):
    # === 代理转发部分 ===
    def _proxy(self, method):
        path = self.path
        if not path.startswith(PROXY_PREFIX):
            # 回退到静态文件
            return super().do_GET() if method == "GET" else super().do_GET()

        target = SUPABASE_URL + path[len(PROXY_PREFIX):] or "/"
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else b""

        # 复制绝大多数请求头，但把 Host/Content-Length 等交给 urllib 处理
        headers = {
            k: v
            for k, v in self.headers.items()
            if k.lower() not in ("host", "content-length", "connection")
        }
        # 保证 Content-Type 不丢失
        if method in ("POST", "PUT", "PATCH") and "content-type" not in [
            k.lower() for k in headers
        ]:
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(target, data=body, headers=headers, method=method)
        try:
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                status = resp.status
                resp_body = resp.read()
                self.send_response(status)
                for k, v in resp.headers.items():
                    # 不转发 Transfer-Encoding，避免与内容长度冲突
                    k_l = k.lower()
                    if k_l in ("transfer-encoding", "content-length", "connection"):
                        continue
                    if k_l == "access-control-allow-origin":
                        v = "*"  # 确保预览页不会被同源策略再次拦截
                    self.send_header(k, v)
                # 必要的 CORS 头，让 iframe / 预览页能读取响应
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "authorization,apikey,content-type,accept,origin,user-agent,x-client-info")
                self.send_header("Access-Control-Expose-Headers", "*")
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            for k, v in e.headers.items():
                kl = k.lower()
                if kl in ("transfer-encoding", "content-length", "connection"):
                    continue
                self.send_header(k, v)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "authorization,apikey,content-type,accept,origin")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:  # urllib.error.URLError / 网络不通
            msg = f"proxy_error: {type(e).__name__}: {e}\ntarget: {target}\n".encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self):
        if self.path.startswith(PROXY_PREFIX):
            self._proxy("GET")
        else:
            path = self.path.lstrip("/")
            if not path or not os.path.exists(path):
                self.path = "index.html"
            super().do_GET()

    def do_POST(self):
        self._proxy("POST")

    def do_PUT(self):
        self._proxy("PUT")

    def do_PATCH(self):
        self._proxy("PATCH")

    def do_DELETE(self):
        self._proxy("DELETE")

    def do_OPTIONS(self):
        # 给预检请求一个宽松的 OK
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "authorization,apikey,content-type,accept,origin,user-agent,x-client-info"
        )
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    # 减少噪音日志
    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + fmt % args + "\n")


if __name__ == "__main__":
    print(f"=== proxy_server 启动 ===")
    print(f"  静态根目录: {os.getcwd()}")
    print(f"  http://localhost:{PORT}/                  → 静态文件")
    print(f"  http://localhost:{PORT}{PROXY_PREFIX}/... → {SUPABASE_URL}/...")
    print(f"  Ctrl+C 退出")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")
