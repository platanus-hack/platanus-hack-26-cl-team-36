"""Llamadas independientes al Claude Code local con salida JSON, sumando tokens y costo."""

from pathlib import Path

from shared.claude.process import ClaudeCodeError, ClaudeCodeProcess

_USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


class ClaudeCallError(Exception):
    """Claude Code no devolvió una salida estructurada."""


class ClaudeCaller:
    def __init__(self, model: str, effort: str, cwd: Path, log_path: Path):
        self.model = model
        self.effort = effort
        self.cwd = cwd
        self.log_path = log_path
        self.usage = dict.fromkeys(_USAGE_KEYS, 0)
        self.cost_usd = 0.0

    async def ask(self, system_prompt: str, schema: dict, text: str, image: bytes | None = None) -> dict:
        process = await ClaudeCodeProcess.open(system_prompt, self.model, self.effort, schema, self.cwd, self.log_path)
        try:
            await process.send(text, image)
            event = await process.wait_for_result()
        except ClaudeCodeError as error:
            raise ClaudeCallError(str(error))
        finally:
            await process.close()
        usage = event.get("usage") or {}
        for key in _USAGE_KEYS:
            self.usage[key] += usage.get(key) or 0
        self.cost_usd += event.get("total_cost_usd") or 0.0
        output = event.get("structured_output")
        if event.get("is_error") or not isinstance(output, dict):
            raise ClaudeCallError(f"Claude Code no devolvió una respuesta estructurada: {str(event.get('result'))[:300]}")
        return output
