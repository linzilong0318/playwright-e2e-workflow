#!/opt/hermes/.venv/bin/python3
"""playwright-e2e-workflow 后端接口公共库(纯 stdlib)。

供 fetch_config.py / upload_artifact.py 复用:
- 接口前缀常量(固定 http://10.120.132.36:8005/ai-test,可 --prefix 覆盖)
- 兼容两种响应 envelope: {code,msg}(文档示例) 与 {success,message}(实测)
  成功判定: code=="200" 或 success==true
- HTTP GET / multipart POST(不依赖 requests)
"""
import json
import mimetypes
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request

mimetypes.add_type("application/json", ".json")
mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("text/plain", ".ts")

DEFAULT_PREFIX = "http://10.120.132.36:8005/ai-test"

# ---- 后端接口常量(v6:五类接口,见 SKILL.md「后端接口」) ----
API_CONFIG_DETAIL = "/api/v1/web-test/config/detail"      # 拉基准配置(可带重复 resourceList 过滤)
API_FUNCTION_RESOURCES = "/api/v1/web-test/function/resources"  # 场景 B:按 functionUid 取脚本/计划/报告
API_FUNCTION_SAVE = "/api/v1/web-test/function/save"       # 场景 A:同步数据库(functionUid 可选:空=新建,传=覆盖更新历史记录,见 publish_artifacts.py)
API_UPLOAD_RAW = "/file/upload"           # 裸 MinIO 上传(只认 file 字段,带业务参数即 00001)
API_UPLOAD_BIZ = "/api/v1/file/upload"    # 业务上传(query type/sessionId/functionUid,按类型整表替换)


def http_get(url: str, timeout: int = 20):
    """GET,返回 (http_status, body_text)。网络异常抛 urllib 异常由调用方处理。"""
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", errors="replace")


def http_post_multipart(url: str, fields: dict, file_field: str, file_path: str,
                        timeout: int = 90):
    """POST multipart/form-data(纯 stdlib 手工拼装)。
    返回 (http_status, body_text)。"""
    boundary = "----hermes-e2e-%08x" % random.randrange(16 ** 8)
    chunks = []
    for k, v in fields.items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        )
    fname = os.path.basename(file_path)
    file_ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    with open(file_path, "rb") as f:
        fdata = f.read()
    chunks.append(
        (f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
         f'filename="{fname}"\r\nContent-Type: {file_ctype}\r\n\r\n').encode()
    )
    chunks.append(fdata)
    chunks.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(chunks)
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", errors="replace")


def http_post_json(url: str, body: dict, timeout: int = 30):
    """POST application/json。返回 (http_status, body_text)。"""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", errors="replace")


def parse_envelope(body: str):
    """解析响应体,兼容 {code,msg} 与 {success,message}。
    返回 (ok: bool, code: str, message: str, data: any)。"""
    try:
        d = json.loads(body)
    except Exception:
        return False, "PARSE_ERR", f"非 JSON 响应: {body[:200]}", None
    data = d.get("data")
    if "success" in d:
        ok = d.get("success") is True
        code = str(d.get("code") or ("200" if ok else "00001"))
        msg = str(d.get("message") or "")
    else:
        code = str(d.get("code") or "")
        ok = code == "200"
        msg = str(d.get("msg") or "")
    return ok, code, msg, data


def session_id_from_env() -> str:
    """sessionId 直接用环境变量 $HERMES_SESSION_ID,不询问用户。"""
    sid = os.environ.get("HERMES_SESSION_ID", "").strip()
    if not sid:
        print("错误: 环境变量 HERMES_SESSION_ID 为空,无法确定 sessionId", file=sys.stderr)
        sys.exit(2)
    return sid


def die(msg: str, code: int = 2):
    print(f"错误: {msg}", file=sys.stderr)
    sys.exit(code)
