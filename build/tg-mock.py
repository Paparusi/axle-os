#!/usr/bin/env python3
# Telegram Bot API giả để thử duyệt mà không cần bot thật. Nghe 127.0.0.1:8099.
#   /bot<token>/sendMessage | editMessageText | answerCallbackQuery | getUpdates  — như Telegram
#   POST /_press {"message_id", "decision": "a"|"r", "from_id"}  — giả làm người bấm nút
#   POST /_send  {"text", "from_id"}                                  — giả làm người nhắn lệnh cho bot
#   GET  /_messages                                              — xem bot đã gửi/sửa gì, token nào
import json, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

lock = threading.Condition()
messages, updates, tokens = {}, [], set()
seq = {"msg": 100, "upd": 1}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        if self.path == "/_messages":
            with lock: return self.reply({"messages": messages, "tokens": sorted(tokens)})
        self.reply({"ok": False}, 404)
    def do_POST(self):
        b = self.body()
        if self.path == "/_send":
            with lock:
                updates.append({"update_id": seq["upd"], "message": {"message_id": 9000 + seq["upd"], "text": b["text"],
                                "from": {"id": b["from_id"]}, "chat": {"id": b["from_id"], "type": "private"}}})
                seq["upd"] += 1; lock.notify_all()
            return self.reply({"ok": True})
        if self.path == "/_press":
            with lock:
                m = messages.get(str(b["message_id"]))
                btn = [x for row in m["reply_markup"]["inline_keyboard"] for x in row if x["callback_data"].endswith(":" + b["decision"])][0]
                updates.append({"update_id": seq["upd"], "callback_query": {"id": f"q{seq['upd']}", "from": {"id": b["from_id"]},
                                "data": btn["callback_data"], "message": {"message_id": int(b["message_id"])}}})
                seq["upd"] += 1; lock.notify_all()
            return self.reply({"ok": True})
        parts = self.path.split("/")
        if len(parts) < 3 or not parts[1].startswith("bot"):
            return self.reply({"ok": False}, 404)
        with lock: tokens.add(parts[1][3:])
        method = parts[2]
        if method == "sendMessage":
            with lock:
                seq["msg"] += 1; mid = seq["msg"]
                messages[str(mid)] = {"chat_id": b["chat_id"], "text": b["text"], "reply_markup": b.get("reply_markup"), "edits": []}
            return self.reply({"ok": True, "result": {"message_id": mid}})
        if method == "editMessageText":
            with lock: messages[str(b["message_id"])]["edits"].append(b["text"])
            return self.reply({"ok": True, "result": True})
        if method == "answerCallbackQuery":
            return self.reply({"ok": True, "result": True})
        if method == "getUpdates":
            deadline = time.time() + min(float(b.get("timeout", 0)), 2)
            with lock:
                while True:
                    res = [u for u in updates if u["update_id"] >= b.get("offset", 0)]
                    if res or time.time() >= deadline: break
                    lock.wait(0.2)
            return self.reply({"ok": True, "result": res})
        self.reply({"ok": False, "description": "không hỗ trợ"}, 400)

ThreadingHTTPServer(("127.0.0.1", 8099), H).serve_forever()
