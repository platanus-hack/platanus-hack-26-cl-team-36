"""Proceso del Claude Code local en stream-json y el bloque de imagen de sus mensajes."""

import asyncio
import base64
import json
from pathlib import Path


def png_image_block(png: bytes) -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(png).decode()},
    }


def content_blocks(parts: list[str | bytes]) -> list[dict]:
    """Texto e imágenes PNG, en el orden en que el modelo los ve."""
    return [{"type": "text", "text": part} if isinstance(part, str) else png_image_block(part) for part in parts]


# Cuánto se espera cada respuesta de `claude -p` antes de darla por perdida.
DEFAULT_TIMEOUT_S = 180


class ClaudeCodeError(Exception):
    pass


class ClaudeCodeProcess:
    """Sesión persistente de `claude -p` con entrada y salida en stream-json."""

    def __init__(self, process: asyncio.subprocess.Process, log_file):
        self.process = process
        self.log_file = log_file
        self.cost_usd = 0.0

    @classmethod
    async def open(cls, system_prompt: str, model: str, effort: str, schema: dict, cwd: Path, log_path: Path):
        command = [
            "claude", "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--model", model,
            "--effort", effort,
            "--tools", "",                  # sin herramientas: no puede leer archivos, ni la web, ni ejecutar nada
            "--strict-mcp-config",          # sin servidores MCP
            "--disable-slash-commands",     # sin skills
            "--setting-sources", "",        # sin hooks ni configuraciones del usuario
            "--no-session-persistence",
            "--system-prompt", system_prompt,
            "--json-schema", json.dumps(schema),
        ]
        log_file = open(log_path, "a", encoding="utf-8")
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=log_file,
            cwd=cwd,
            limit=64 * 1024 * 1024,
        )
        return cls(process, log_file)

    async def send(self, text: str, image: bytes | None = None) -> None:
        await self.send_content(content_blocks([text] if image is None else [text, image]))

    async def send_content(self, content: list[dict]) -> None:
        message = {"type": "user", "message": {"role": "user", "content": content}}
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        await self.process.stdin.drain()

    async def wait_for_result(self, timeout_s: float = DEFAULT_TIMEOUT_S) -> dict:
        """El próximo evento `result`; si `claude` no responde en `timeout_s`, ClaudeCodeError."""
        try:
            return await asyncio.wait_for(self._read_result(), timeout=timeout_s)
        except TimeoutError:
            raise ClaudeCodeError(f"claude no respondió en {timeout_s:.0f} s") from None

    async def _read_result(self) -> dict:
        while True:
            line = await self.process.stdout.readline()
            if not line:
                raise ClaudeCodeError(f"claude terminó inesperadamente (código {self.process.returncode})")
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "result":
                self.cost_usd = event.get("total_cost_usd") or self.cost_usd
                return event

    async def close(self) -> None:
        try:
            if self.process.stdin and not self.process.stdin.is_closing():
                self.process.stdin.close()
            await asyncio.wait_for(self.process.wait(), timeout=10)
        except (TimeoutError, ProcessLookupError, BrokenPipeError, ConnectionResetError):
            try:
                self.process.kill()
            except ProcessLookupError:
                pass
        finally:
            self.log_file.close()
