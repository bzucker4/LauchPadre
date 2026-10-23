"""
LaunchPadre Phase 2 — Three-Layer Data Sovereignty System
Target: Python 3.11+ | FastAPI / Starlette ASGI Middleware

Enforces total source tree isolation against commercial LLM scrapers, AI dataset spiders,
and unauthorized automated crawlers through:
  - Layer A: Explicit Dynamic Robots.txt directives.
  - Layer B: Request-time User-Agent scraper fingerprinting interception (403 Forbidden).
  - Layer C: Global X-Robots-Tag (noindex, nofollow, noarchive) header injection.
"""

from __future__ import annotations

import logging
from typing import Callable
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response


logger = logging.getLogger("launchpadre.sovereignty")

# Canonical directory and URL prefixes forbidden from AI indexing
BLOCKED_PATH_PATTERNS: tuple[str, ...] = (
    "/*/src/",
    "/*/commits/",
    "/*/raw/",
    "/*/archive/",
    "/*/tree/",
    "/*/blob/",
    "/api/",
)

# Comprehensive catalog of known LLM crawler, scraper, and dataset spider signatures (lowercase)
BANNED_AI_SCRAPER_FINGERPRINTS: tuple[str, ...] = (
    "gptbot",
    "chatgpt-user",
    "claudebot",
    "claude-web",
    "perplexitybot",
    "anthropic-ai",
    "google-extended",
    "bytespider",
    "ccbot",
    "facebookbot",
    "amazonbot",
    "applebot-extended",
    "omgilibot",
    "omgili",
    "diffbot",
    "cohere-ai",
    "timpibot",
    "ai2bot",
    "webz.io",
    "scrappy",
    "barkrowler",
    "meta-externalagent",
    "turnitinbot",
    "youbot",
)

# Layer A: Explicit Plaintext robots.txt configuration
DYNAMIC_ROBOTS_TXT_BODY: str = """# ==============================================================================
# LaunchPadre Data Sovereignty Architecture — Anti-Scraper Directives
# Notice: Autonomous AI training, scraping, and LLM dataset extraction are strictly
# forbidden without explicit cryptographic licensing agreements.
# ==============================================================================

User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Anthropic-AI
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: FacebookBot
Disallow: /

User-agent: Amazonbot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Diffbot
Disallow: /

User-agent: Omgilibot
Disallow: /

User-agent: Cohere-ai
Disallow: /

# General Crawlers (Strict Code Privacy Boundaries)
User-agent: *
Disallow: /*/src/
Disallow: /*/commits/
Disallow: /*/raw/
Disallow: /*/archive/
Disallow: /*/tree/
Disallow: /*/blob/
Disallow: /api/
Allow: /$
Allow: /robots.txt$
"""


class DataSovereigntyMiddleware(BaseHTTPMiddleware):
    """
    Core ASGI middleware implementing:
      - Layer B: High-performance User-Agent fingerprinting and early termination (403 Forbidden).
      - Layer C: Response metadata header injection ('X-Robots-Tag: noindex, nofollow, noarchive').
    """

    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        user_agent_header = request.headers.get("user-agent", "").strip().lower()

        # Layer B: Dynamic User-Agent Scraper Fingerprinting Inspection
        if user_agent_header:
            for signature in BANNED_AI_SCRAPER_FINGERPRINTS:
                if signature in user_agent_header:
                    client_ip = request.client.host if request.client else "unknown"
                    logger.warning(
                        "Scraper rejected: intercepted unauthorized AI agent",
                        extra={
                            "scraper_agent": user_agent_header[:120],
                            "matched_signature": signature,
                            "client_ip": client_ip,
                            "path": request.url.path,
                        },
                    )
                    return PlainTextResponse(
                        content=(
                            "403 Forbidden: Autonomous AI scrapers and dataset crawlers "
                            f"are strictly prohibited by LaunchPadre Data Sovereignty Policies. "
                            f"(Matched pattern: {signature})\n"
                        ),
                        status_code=403,
                        headers={
                            "X-Robots-Tag": "noindex, nofollow, noarchive",
                            "Cache-Control": "no-store, no-cache, must-revalidate",
                        },
                    )

        # Allow legitimate developer and user traffic to proceed
        response = await call_next(request)

        # Layer C: Explicit Metadata Header Injection
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        response.headers["X-Content-Type-Options"] = "nosniff"

        return response
