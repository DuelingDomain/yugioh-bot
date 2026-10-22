#!/usr/bin/env python3
"""Integration: real Caddy holds a POST across 20s of Docker upstream downtime.

Uses the cached caddy:2.11.2-alpine image, temporary containers/network, no live services.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
import time

spec = importlib.util.spec_from_file_location("routing", Path(__file__).with_name("verify-domain-routing.py"))
routing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routing)


def deliveries(container, path):
    logs = routing.docker("logs", container)
    return sum(json.loads(line).get("request", {}).get("uri") == path
               for line in logs.splitlines() if line.startswith("{"))


def main():
    routing.docker("image", "inspect", routing.IMAGE)
    routing.docker("network", "create", routing.NETWORK)
    public = routing.ARTIFACTS / "public"
    public.mkdir()
    (public / "index.html").write_text("marketing index")
    stub = routing.ARTIFACTS / "Caddyfile.upstream"
    stub.write_text('''{
    admin off
}
:3000 {
    log {
        output stdout
        format json
    }
    abort /accepted-then-drop
    respond /unavailable "unavailable" 503
    respond "web {method} {uri}" 200
}
:3001 {
    respond "ws {method} {uri}" 200
}
''')
    env = {"SITE_DOMAIN": "app.localhost", "MARKETING_DOMAIN": "marketing.localhost", "LEGACY_DOMAIN": "legacy.localhost"}
    routing.validate(routing.ROOT / "Caddyfile", "split", env)
    routing.validate(routing.ROOT / "Caddyfile", "unset", {"SITE_DOMAIN": "localhost"})
    upstream = routing.start(routing.NETWORK + "-upstream", stub, upstream=True)
    proxy = routing.start(routing.NETWORK + "-proxy", routing.ROOT / "Caddyfile", env)
    ports = routing.ports(proxy)
    routing.ready(ports, "app.localhost")
    routing.check(ports, "app.localhost", body="web GET /")
    routing.check(ports, "app.localhost", "/socket.io/?EIO=4", body="ws GET /socket.io/?EIO=4")
    routing.check(ports, "marketing.localhost", body="marketing index")
    routing.check(ports, "marketing.localhost", "/api/waitlist", method="POST", body="web POST /api/waitlist")
    routing.check(ports, "legacy.localhost", "/duels/example?x=1", status=308,
                  location="https://app.localhost/duels/example?x=1")

    # Caddy cannot know whether this connected POST took effect: it must not replay it.
    # Proxy-generated errors do not run the normal upstream-response header hook.
    assert routing.request(ports, "app.localhost", "/accepted-then-drop", method="POST")[0] == 502
    assert deliveries(upstream, "/accepted-then-drop") == 1
    routing.check(ports, "app.localhost", "/unavailable", method="POST", status=503, body="unavailable")
    assert deliveries(upstream, "/unavailable") == 1

    routing.docker("stop", upstream)
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=1) as pool:
        held = pool.submit(routing.request, ports, "app.localhost", "/held-action", method="POST",
                           extra=["--max-time", "35"])
        time.sleep(20)
        assert not held.done(), "Caddy returned before the upstream recovered"
        recovered = routing.start(routing.NETWORK + "-recovered", stub, upstream=True)
        status, _, body = held.result(timeout=15)
    assert status == 200 and body == "web POST /held-action", (status, body)
    assert 20 <= time.monotonic() - started < 32
    assert deliveries(recovered, "/held-action") == 1
    print(f"PASS: validation, domain routes, 20s POST hold, single delivery, no connected-POST retry. Artifacts: {routing.ARTIFACTS}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr, flush=True)
        raise
    finally:
        for container in reversed(routing.CONTAINERS):
            log = routing.run(["docker", "logs", container], check=False)
            (routing.ARTIFACTS / f"{container}.log").write_text(log.stdout + log.stderr)
            routing.run(["docker", "rm", "-f", container], check=False)
        routing.run(["docker", "network", "rm", routing.NETWORK], check=False)
