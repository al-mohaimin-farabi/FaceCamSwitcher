"""
Server Sender — Configurable HTTP client to push recognised player names
to your website / API server.

All connection details are read from config.json → "server" section.
You can change the URL, headers, method, and auth without touching code.
"""

import json
import time
from pathlib import Path
from typing import Optional

import requests

# ──────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path(__file__).parent / "config.json"


def _load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


class ServerSender:
    """Send OCR results to a remote server."""

    def __init__(self, config: Optional[dict] = None):
        self.config = config or _load_config()
        srv = self.config.get("server", {})

        self.url = srv.get("url", "http://localhost:3000/api/facecam")
        self.method = srv.get("method", "POST").upper()
        self.headers = srv.get("headers", {"Content-Type": "application/json"})
        self.timeout = srv.get("timeout", 10)
        self.retry_count = srv.get("retry_count", 3)
        self.retry_delay = srv.get("retry_delay", 2)

        print(f"[Server] Endpoint : {self.method} {self.url}")

    # ─── Public API ──────────────────────────────────────────────────

    def send(self, detections: list[dict]) -> bool:
        """
        Send a list of detection dicts to the server.

        Payload shape:
        {
            "timestamp": "2026-03-07T05:30:00",
            "players": [
                {
                    "raw_text": "...",
                    "cleaned_text": "...",
                    "confidence": 0.95,
                    "matched_name": "PlayerOne",
                    "match_score": 92
                },
                ...
            ]
        }

        Returns True on success, False otherwise.
        """
        if not detections:
            return True  # nothing to send

        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "players": detections,
        }

        for attempt in range(1, self.retry_count + 1):
            try:
                resp = self._do_request(payload)
                if resp.ok:
                    print(f"[Server] [OK] Sent {len(detections)} detection(s) — "
                          f"HTTP {resp.status_code}")
                    return True
                else:
                    print(f"[Server] [FAIL] HTTP {resp.status_code} — {resp.text[:200]}")
            except requests.ConnectionError:
                print(f"[Server] [FAIL] Connection refused (attempt {attempt}/{self.retry_count})")
            except requests.Timeout:
                print(f"[Server] [FAIL] Timeout (attempt {attempt}/{self.retry_count})")
            except Exception as exc:
                print(f"[Server] [FAIL] Error: {exc} (attempt {attempt}/{self.retry_count})")

            if attempt < self.retry_count:
                time.sleep(self.retry_delay)

        print("[Server] [FAIL] All retries exhausted.")
        return False

    def send_single(self, player_name: str, raw_text: str = "",
                    confidence: float = 0.0, match_score: int = 0) -> bool:
        """Convenience wrapper to send a single player detection."""
        return self.send([{
            "raw_text": raw_text,
            "cleaned_text": raw_text,
            "confidence": confidence,
            "matched_name": player_name,
            "match_score": match_score,
        }])

    # ─── Internal ────────────────────────────────────────────────────

    def _do_request(self, payload: dict) -> requests.Response:
        """Execute the actual HTTP request."""
        if self.method == "POST":
            return requests.post(
                self.url, json=payload,
                headers=self.headers, timeout=self.timeout,
            )
        elif self.method == "PUT":
            return requests.put(
                self.url, json=payload,
                headers=self.headers, timeout=self.timeout,
            )
        elif self.method == "PATCH":
            return requests.patch(
                self.url, json=payload,
                headers=self.headers, timeout=self.timeout,
            )
        else:
            raise ValueError(f"Unsupported HTTP method: {self.method}")

    # ─── Hot reload ──────────────────────────────────────────────────

    def reload_config(self):
        """Re-read connection settings from config.json."""
        self.config = _load_config()
        srv = self.config.get("server", {})
        self.url = srv.get("url", self.url)
        self.method = srv.get("method", self.method).upper()
        self.headers = srv.get("headers", self.headers)
        self.timeout = srv.get("timeout", self.timeout)
        self.retry_count = srv.get("retry_count", self.retry_count)
        self.retry_delay = srv.get("retry_delay", self.retry_delay)
        print(f"[Server] Config reloaded — {self.method} {self.url}")


# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    sender = ServerSender()
    ok = sender.send([{
        "raw_text": "TestPlayer",
        "cleaned_text": "TestPlayer",
        "confidence": 0.99,
        "matched_name": "TestPlayer",
        "match_score": 100,
    }])
    print(f"\nTest send result: {'SUCCESS' if ok else 'FAILED'}")
