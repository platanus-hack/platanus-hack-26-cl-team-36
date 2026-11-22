import asyncio

import pytest

from shared.claude.process import ClaudeCodeError, ClaudeCodeProcess


def test_claude_code_sin_respuesta_da_un_error_claro_en_vez_de_esperar_para_siempre(tmp_path):
    async def escenario():
        proceso = await asyncio.create_subprocess_exec(
            "sleep", "30", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
        )
        claude = ClaudeCodeProcess(proceso, open(tmp_path / "log", "a", encoding="utf-8"))
        try:
            with pytest.raises(ClaudeCodeError, match="no respondió en 0 s"):
                await claude.wait_for_result(timeout_s=0.2)
        finally:
            proceso.kill()
            await proceso.wait()
            claude.log_file.close()

    asyncio.run(escenario())
