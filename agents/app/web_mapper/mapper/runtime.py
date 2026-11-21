"""Navegador y carpeta de trabajo de Claude Code compartidos por una corrida."""

import shutil
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from playwright.async_api import Browser, async_playwright

from browser import connect_browser


@asynccontextmanager
async def runtime(cdp_url: str | None) -> AsyncIterator[tuple[Browser, Path]]:
    # Carpeta vacía: Claude Code no carga CLAUDE.md ni memoria.
    claude_cwd = Path(tempfile.mkdtemp(prefix="web_mapper-claude-"))
    try:
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright, cdp_url)
            try:
                yield browser, claude_cwd
            finally:
                await browser.close()
    finally:
        shutil.rmtree(claude_cwd, ignore_errors=True)
