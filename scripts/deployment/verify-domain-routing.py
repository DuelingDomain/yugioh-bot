#!/usr/bin/env python3
"""Exercise the real Caddyfile with Docker + curl; no app, DNS, or site/ writes.

Run from any directory: python3 scripts/deployment/verify-domain-routing.py
Requires Docker daemon access, caddy:2-alpine (pulled if needed), curl, Python 3.
All containers/networks are temporary; output and adapted JSON stay in /tmp.
"""
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
import uuid

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = Path(tempfile.mkdtemp(prefix="dueling-domain-caddy-"))
NETWORK = "domain-verify-" + uuid.uuid4().hex[:10]
CONTAINERS = []
IMAGE = "caddy:2-alpine"
BASELINE = """{$SITE_DOMAIN} {
    handle /socket.io/* {
        reverse_proxy ws:3001
    }
    reverse_proxy web:3000
}

# Canonical host, including old HTTP IP links posted in Discord.
www.{$SITE_DOMAIN}, http:// {
    redir https://{$SITE_DOMAIN}{uri} 308
}
"""

APP_SEO = """    # The private app must stay out of search, including on the current host.
    header >X-Robots-Tag "noindex, nofollow"
    handle /robots.txt {
        header Content-Type "text/plain; charset=utf-8"
        respond "User-agent: *
Disallow: /
" 200
    }
"""
ROBOTS = "User-agent: *\nDisallow: /"


def check_security(host, headers):
    if host == "app.localhost":
        assert headers.get("x-robots-tag") == "noindex, nofollow", headers
    if host != "marketing.localhost":
        return
    assert headers.get("strict-transport-security") == "max-age=31536000", headers
    csp = headers.get("content-security-policy", "")
    directives = dict((parts[0], set(parts[1:])) for directive in csp.split(";")
                      if (parts := directive.split()))
    for key, values in {
        "default-src": {"'self'"}, "img-src": {"'self'", "data:"},
        "script-src": {"'self'"}, "connect-src": {"'self'"},
        "frame-ancestors": {"'none'"}, "base-uri": {"'self'"}, "form-action": {"'self'"}
    }.items():
        assert directives.get(key) == values, (key, csp)
    # The documented network fallback temporarily permits only the two font origins.
    google_fonts = "fonts.googleapis.com" in (ROOT / "site/public/index.html").read_text()
    assert directives.get("style-src") == ({"'self'", "'unsafe-inline'"} |
        ({"https://fonts.googleapis.com"} if google_fonts else set())), csp
    assert directives.get("font-src") == ({"'self'"} |
        ({"https://fonts.gstatic.com"} if google_fonts else set())), csp


def run(args, check=True):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def docker(*args):
    return run(["docker", *args]).stdout.strip()


def start(name, config, env=None, upstream=False):
    args = ["run", "--rm", "-d", "--name", name, "--network", NETWORK,
            "-v", f"{config}:/etc/caddy/Caddyfile:ro"]
    if upstream:
        args += ["--network-alias", "web", "--network-alias", "ws"]
    else:
        args += ["-p", "127.0.0.1::80", "-p", "127.0.0.1::443",
                 "-v", f"{ARTIFACTS / 'public'}:/srv/site:ro"]
    for key, value in (env or {}).items():
        args += ["-e", f"{key}={value}"]
    docker(*args, IMAGE)
    CONTAINERS.append(name)
    return name


def ports(name):
    return {port: docker("port", name, f"{port}/tcp").rsplit(":", 1)[1] for port in (80, 443)}


def request(port_map, host, path="/", scheme="https", method="GET", print_result=True, extra=None):
    port = port_map[443 if scheme == "https" else 80]
    args = ["curl", "--noproxy", "*", "-ksS", "--max-time", "5", "-D", "-", "-X", method]
    if scheme == "https":
        args += ["--resolve", f"{host}:{port}:127.0.0.1", f"https://{host}:{port}{path}"]
    else:
        args += ["-H", f"Host: {host}", f"http://127.0.0.1:{port}{path}"]
    if method == "POST":
        args += ["-H", "Content-Type: application/json", "--data", '{"email":"test@example.com"}']
    args += extra or []
    result = run(args)
    headers, _, body = result.stdout.partition("\n\n")
    lines = headers.splitlines()
    status = int(lines[0].split()[1])
    fields = {key.lower(): value for line in lines[1:] if ": " in line
              for key, value in [line.split(": ", 1)]}
    if print_result:
        print("$ " + shlex.join(args), flush=True)
        print(result.stdout, flush=True)
    return status, fields, body


def ready(port_map, host):
    for _ in range(50):
        try:
            request(port_map, "127.0.0.1", scheme="http", print_result=False)
            request(port_map, host, print_result=False)
            return
        except subprocess.CalledProcessError:
            time.sleep(0.2)
    raise RuntimeError("Caddy did not start")


def check(port_map, host, path="/", status=200, body=None, location=None, **kwargs):
    actual, headers, text = request(port_map, host, path, **kwargs)
    assert actual == status, (host, path, actual, status)
    if body is not None:
        assert text.strip() == body, (host, path, text, body)
    if location is not None:
        assert headers.get("location") == location, headers
    if kwargs.get("scheme", "https") == "https":
        check_security(host, headers)
    return actual, headers, text


def validate(config, label, env):
    args = ["run", "--rm", "-v", f"{config}:/etc/caddy/Caddyfile:ro"]
    for key, value in env.items():
        args += ["-e", f"{key}={value}"]
    print(f"{label}: " + docker(*args, IMAGE, "caddy", "validate", "--config", "/etc/caddy/Caddyfile"), flush=True)
    adapted = docker(*args, IMAGE, "caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--pretty")
    json.loads(adapted)
    (ARTIFACTS / f"{label}.json").write_text(adapted)


def main():
    docker("info")  # Fail clearly before creating resources if the socket is unavailable.
    docker("network", "create", NETWORK)
    public = ARTIFACTS / "public"
    public.mkdir()
    for file, text in {"index.html": "marketing index", "404.html": "marketing custom 404",
                       "privacy.html": "privacy clean URL", "style.css": "body{}", "logo.svg": "<svg/>"}.items():
        (public / file).write_text(text)
    for name in ("sitemap.xml", "site.webmanifest", "robots.txt"):
        (public / name).write_bytes((ROOT / "site/public" / name).read_bytes())
    (public / "fonts").mkdir()
    (public / "fonts/check.woff2").write_bytes(b"wOF2-cache-fixture")
    baseline = ARTIFACTS / "Caddyfile.before"
    baseline.write_text(BASELINE)
    assert (ROOT / "Caddyfile").read_text().replace(APP_SEO, "", 1).startswith(BASELINE), "App blocks changed beyond robots/noindex"
    stub = ARTIFACTS / "Caddyfile.upstream"
    stub.write_text(':3000 {\n redir /needs-login /login 302\n respond "web {method} {uri}" 200\n}\n:3001 {\n respond "ws {method} {uri}" 200\n}\n')
    start(NETWORK + "-upstream", stub, upstream=True)

    split_env = {"SITE_DOMAIN": "app.localhost", "MARKETING_DOMAIN": "marketing.localhost", "LEGACY_DOMAIN": "legacy.localhost"}
    validate(ROOT / "Caddyfile", "split", split_env)
    split = start(NETWORK + "-split", ROOT / "Caddyfile", split_env)
    p = ports(split)
    ready(p, "app.localhost")
    check(p, "app.localhost", body="web GET /")
    _, headers, _ = check(p, "app.localhost", "/robots.txt", body=ROBOTS)
    assert headers.get("content-type") == "text/plain; charset=utf-8"
    check(p, "app.localhost", "/robots.txt?from=crawler", body=ROBOTS)
    check(p, "app.localhost", "/needs-login", status=302, location="/login")
    check(p, "app.localhost", "/socket.io/?EIO=4&transport=polling", body="ws GET /socket.io/?EIO=4&transport=polling")
    check(p, "www.app.localhost", "/draft/abc?x=1", status=308, location="https://app.localhost/draft/abc?x=1")
    _, headers, _ = check(p, "marketing.localhost", body="marketing index")
    assert headers["cache-control"] == "public, max-age=300, must-revalidate"
    assert headers["etag"] and headers["x-frame-options"] == "DENY"
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
    check(p, "marketing.localhost", status=304, extra=["-H", "If-None-Match: " + headers["etag"]])
    check(p, "marketing.localhost", "/privacy", body="privacy clean URL")
    check(p, "marketing.localhost", "/privacy.html", body="privacy clean URL")
    _, headers, sitemap = check(p, "marketing.localhost", "/sitemap.xml")
    assert headers["content-type"].split(";")[0] in ("application/xml", "text/xml")
    assert headers["cache-control"] == "public, max-age=300, must-revalidate"
    urls = [node.text for node in ET.fromstring(sitemap).iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    assert urls == ["https://duelingdomain.com/", "https://duelingdomain.com/privacy"], urls
    _, headers, manifest = check(p, "marketing.localhost", "/site.webmanifest")
    assert headers["content-type"] == "application/manifest+json", headers
    assert json.loads(manifest)["name"] == "Dueling Domain"
    assert headers["cache-control"] == "public, max-age=300, must-revalidate"
    _, _, robots = check(p, "marketing.localhost", "/robots.txt")
    assert "Sitemap: https://duelingdomain.com/sitemap.xml" in robots
    _, headers, _ = check(p, "marketing.localhost", "/fonts/check.woff2")
    assert headers["cache-control"] == "public, max-age=31536000", headers
    _, headers, _ = check(p, "marketing.localhost", "/fonts/missing.woff2", status=404, body="marketing custom 404")
    assert headers["cache-control"] == "no-store", headers
    check(p, "marketing.localhost", "/missing", status=404, body="marketing custom 404")
    check(p, "marketing.localhost", "/login", status=302, location="https://app.localhost/login")
    check(p, "marketing.localhost", "/api/waitlist", method="POST", body="web POST /api/waitlist")
    for path in ("/api/anything-else", "/api/waitlist", "/socket.io/", "/api/waitlistx"):
        check(p, "marketing.localhost", path, status=404, body="marketing custom 404")
    check(p, "marketing.localhost", "/api/waitlist/", method="POST", status=404, body="marketing custom 404")
    _, headers, _ = check(p, "marketing.localhost", "/logo.svg", body="<svg/>")
    assert headers["cache-control"] == "public, max-age=86400"
    _, headers, _ = check(p, "marketing.localhost", "/style.css", body="body{}")
    assert headers["cache-control"] == "public, max-age=300, must-revalidate"
    for scheme in ("http", "https"):
        for host in ("legacy.localhost", "www.legacy.localhost"):
            for path in ("/draft/abc?x=1", "/robots.txt"):
                check(p, host, path, scheme=scheme, status=308, location="https://app.localhost" + path)
        check(p, "www.marketing.localhost", "/privacy?x=1", scheme=scheme, status=308, location="https://marketing.localhost/privacy?x=1")
    check(p, "marketing.localhost", "/privacy", scheme="http", status=308, location="https://marketing.localhost/privacy")
    check(p, "app.localhost", "/draft/abc", scheme="http", status=308, location="https://app.localhost/draft/abc")
    check(p, "198.51.100.2", "/draft/abc", scheme="http", status=308, location="https://app.localhost/draft/abc")

    # Compare to the original Caddyfile, allowing only the app robots/noindex changes.
    env = {"SITE_DOMAIN": "localhost"}
    validate(baseline, "before", env)
    validate(ROOT / "Caddyfile", "unset", env)
    before = start(NETWORK + "-before", baseline, env)
    unset = start(NETWORK + "-unset", ROOT / "Caddyfile", env)
    a, b = ports(before), ports(unset)
    ready(a, "localhost")
    ready(b, "localhost")
    cases = [(scheme, host, path) for scheme in ("http", "https")
             for host in ("localhost", "www.localhost")
             for path in ("/", "/socket.io/?EIO=4", "/draft/abc?x=1", "/robots.txt", "/needs-login")]
    cases.append(("http", "198.51.100.2", "/draft/abc?x=1"))
    for scheme, host, path in cases:
        old = request(a, host, path, scheme=scheme)
        new = request(b, host, path, scheme=scheme)
        # Date and Alt-Svc use different runtime values/ephemeral ports.
        stable = lambda res: (res[0], {k: v for k, v in res[1].items() if k not in ("date", "alt-svc")}, res[2])
        if scheme == "https" and host == "localhost":
            assert "x-robots-tag" not in old[1], old
            assert new[1].get("x-robots-tag") == "noindex, nofollow", new
            without_noindex = {k: v for k, v in new[1].items() if k != "x-robots-tag"}
            if path == "/robots.txt":
                assert old[0] == new[0] == 200, (old, new)
                assert old[2].strip() == "web GET /robots.txt", old
                assert new[2] == ROBOTS + "\n", new
                assert new[1].get("content-type") == "text/plain; charset=utf-8", new
                # Only the intentional body, its length and the proxy Via header differ:
                # Caddy now answers this route itself instead of proxying to web.
                old_headers = {k: v for k, v in old[1].items() if k not in ("content-length", "via")}
                new_headers = {k: v for k, v in without_noindex.items() if k != "content-length"}
                assert stable((old[0], old_headers, "")) == stable((new[0], new_headers, "")), (old, new)
            else:
                assert stable(old) == stable((new[0], without_noindex, new[2])), (old, new)
        else:
            assert stable(old) == stable(new), (scheme, host, path, old, new)
    print(f"PASS: split routes and {len(cases)} unset/baseline comparisons. Artifacts: {ARTIFACTS}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr, flush=True)
        raise
    finally:
        for container in reversed(CONTAINERS):
            log = run(["docker", "logs", container], check=False)
            (ARTIFACTS / f"{container}.log").write_text(log.stdout + log.stderr)
            run(["docker", "rm", "-f", container], check=False)
        run(["docker", "network", "rm", NETWORK], check=False)
