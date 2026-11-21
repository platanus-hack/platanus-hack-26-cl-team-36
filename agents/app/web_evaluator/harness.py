"""Ciclo de un usuario sintético: captura -> el motor decide -> Playwright ejecuta -> se registra."""

import asyncio
import time
from datetime import datetime, timedelta
from pathlib import Path

from playwright.async_api import Browser

from actions import CLICK_ACTIONS, UI_ACTIONS, VOLVER_A_NODO, Executor, InvalidActionError, UnavailableActionError
from browser import BrowserSession, create_context
from engines import ActionRequest, ActionResult, AttemptEnded
from profiles import Profile, system_prompt
from recording import Run, Step, blocked_form_count, element_at, has_no_effect, screen_change_ratio, visible_error
from route_tree import node_key, normalize_url

NOT_EXECUTED_MESSAGE = "Not executed: an earlier computer action in this turn failed."


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds")


class SyntheticUser:
    def __init__(
        self,
        engine,
        browser: Browser,
        profile: Profile,
        url: str,
        instruction: str,
        run_dir: Path,
        record_video: bool = False,
    ):
        self.engine = engine
        self.browser = browser
        self.profile = profile
        self.url = url
        self.instruction = instruction
        self.run_dir = run_dir
        self.record_video = record_video
        self.session: BrowserSession | None = None
        self.run = Run(
            profile=profile.key,
            profile_name=profile.name,
            viewport=f"{profile.width}x{profile.height}",
            model=engine.model,
            engine=engine.name,
            start_url=url,
            instruction=instruction,
        )

    def _log(self, text: str) -> None:
        print(f"[{self.profile.key}] {text}", flush=True)

    async def attempt(self) -> Run:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        context = await create_context(self.browser, self.profile, self.run_dir if self.record_video else None)
        try:
            self.session = BrowserSession(context, self.profile)
            self.executor = Executor(self.session)
            await self.session.open(self.url)
            await self._loop()
        finally:
            try:
                await self.engine.close()
            finally:
                self.run.token_usage = self.engine.usage
                self.run.save(self.run_dir)  # antes de cerrar el navegador: si eso falla, el resultado ya quedó
                try:
                    await context.close()  # recién aquí Playwright termina de escribir los videos
                    if self.record_video and self.session:
                        self.run.videos = await self.session.save_videos(self.run_dir, self.run.incidents)
                except Exception as error:  # el intento ya terminó: un fallo al cerrar no debe cambiar su resultado
                    self.run.incidents.append(f"al cerrar el navegador: {type(error).__name__}: {error}"[:300])
                self.run.save(self.run_dir)
        return self.run

    async def _loop(self) -> None:
        run = self.run
        self.current_screenshot = await self.session.screenshot()
        url, title = await self.session.url_and_title()
        run.start = {"url": url, "title": title, "screenshot": self._save_screenshot(0, self.current_screenshot)}
        run.final_screenshot = run.start["screenshot"]
        self.visited_nodes = {node_key(url, title)}
        # Páginas vistas en este intento, con un id corto para `volver_a_nodo`: clave del nodo -> (id, url, título).
        self.paginas: dict[str, tuple[str, str, str]] = {}
        self._registrar_pagina(url, title)
        self.started_at = time.monotonic()
        self.started_wall = datetime.now().astimezone()
        run.start["at"] = run.started_at = _iso(self.started_wall)
        self.decided_s: float | None = None
        if self.session.opened_at is not None:
            run.video_offset_s = round(self.started_at - self.session.opened_at, 2)
        self.last_step_end_s = 0.0
        self._log(f"inicio en {url} — {title!r}")

        try:
            await self.engine.start(
                system_prompt(self.profile, self.engine.name),
                f"Tu tarea: {self.instruction}\n\nEsta es la pantalla inicial del sitio.",
                self.current_screenshot,
                self.run_dir,
            )
            while True:
                if run.turns >= self.profile.limite_turnos:
                    raise AttemptEnded("step_limit", "Se alcanzó el máximo de turnos del modelo.")
                remaining_s = self.profile.limite_segundos - (time.monotonic() - self.started_at)
                if remaining_s <= 0:
                    raise AttemptEnded("time_limit")
                run.turns += 1
                try:
                    turn = await asyncio.wait_for(self.engine.decide(), timeout=remaining_s)
                except TimeoutError:
                    raise AttemptEnded("time_limit")
                self.decided_s = self._elapsed()
                if turn.final:
                    raise AttemptEnded(*turn.final)
                results = await self._process_requests(turn.requests)
                if self.profile.explora:
                    self._agregar_presupuesto(results)
                await self.engine.respond(results, self.current_screenshot)
        except AttemptEnded as ended:
            run.end_reason = ended.reason
            run.final_message = ended.message
        run.duration_s = round(time.monotonic() - self.started_at, 1)
        self._log(f"fin: {run.end_reason} — {run.final_message[:120]}")

    async def _process_requests(self, requests: list[ActionRequest]) -> list[ActionResult]:
        """Ejecuta los pedidos en orden. Tras el primer fallo, el resto no se ejecuta."""
        results: list[ActionResult] = []
        expectation: str | None = None
        failed = False
        for request in requests:
            if failed:
                results.append(ActionResult(request, NOT_EXECUTED_MESSAGE, is_error=True))
                continue
            if not request.is_computer:
                if request.name == "expectation":
                    expectation = (request.input.get("sentence") or "").strip()
                    results.append(ActionResult(request, "OK"))
                else:
                    results.append(ActionResult(request, f"Herramienta desconocida: {request.name}", is_error=True))
                    failed = True
                continue
            if request.name == "screenshot":
                self.run.screenshots_requested += 1
                self.current_screenshot = await self.session.screenshot()
                results.append(ActionResult(request, "OK", image=self.current_screenshot))
                continue
            if request.name not in UI_ACTIONS:
                self.run.incidents.append(f"pidió la acción no disponible '{request.name}'")
                results.append(ActionResult(
                    request, f"La acción '{request.name}' no está disponible en este entorno.", is_error=True
                ))
                failed = True
                continue
            if len(self.run.steps) >= self.profile.limite_acciones:
                raise AttemptEnded("step_limit")
            if not expectation:
                self.run.incidents.append(f"intentó '{request.name}' sin declarar su expectativa")
                results.append(ActionResult(
                    request, "Antes de esta acción debes declarar tu expectativa en una frase. No se ejecutó.", is_error=True
                ))
                failed = True
                continue
            try:
                action_input = self._resolver_volver(request.input) if request.name == VOLVER_A_NODO else request.input
                await self._execute_step(request.name, action_input, expectation)
                results.append(ActionResult(request, "OK"))
            except (InvalidActionError, UnavailableActionError) as error:
                self.run.incidents.append(f"{request.name}: {error}")
                results.append(ActionResult(request, str(error), is_error=True))
                failed = True
            expectation = None
            if time.monotonic() - self.started_at > self.profile.limite_segundos:
                raise AttemptEnded("time_limit")
        return results

    def _agregar_presupuesto(self, results: list[ActionResult]) -> None:
        """Suma al último resultado del turno cuántas acciones y segundos le quedan al usuario.

        Los exploradores lo necesitan para decidir cuándo dejar de probar caminos y volver a la respuesta.
        """
        ultimo = next((result for result in reversed(results) if result.image is None), None)
        if ultimo is None:
            return
        hechas, limite = len(self.run.steps), self.profile.limite_acciones
        segundos = max(0, int(self.profile.limite_segundos - (time.monotonic() - self.started_at)))
        nota = f"Llevas {hechas} de {limite} acciones: te quedan {limite - hechas} acciones y {segundos} s."
        if self.engine.name == "claude-code":  # volver_a_nodo solo existe en el esquema JSON de Claude Code
            nota += f" {self._paginas_vistas()}"
        ultimo.text = f"{ultimo.text.rstrip('.')}. {nota}"

    def _registrar_pagina(self, url: str, title: str) -> None:
        key = self._nodo_actual = node_key(url, title)
        if key not in self.paginas:
            self.paginas[key] = (f"p{len(self.paginas) + 1}", url, (title or "").strip())

    def _paginas_vistas(self) -> str:
        actual = self.paginas.get(self._nodo_actual)
        lista = ", ".join(f"{pid} «{(titulo or normalize_url(url))[:50]}»" for pid, url, titulo in self.paginas.values())
        return f"Páginas vistas: {lista}." + (f" Estás en {actual[0]}." if actual else "")

    def _resolver_volver(self, action_input: dict) -> dict:
        """El nodo que pidió el modelo -> la URL que guardó el harness al verlo."""
        if not self.profile.explora:
            raise UnavailableActionError(f"La acción '{VOLVER_A_NODO}' no está disponible en este entorno.")
        pedido = str(action_input.get("nodo") or "").strip().lower()
        for pid, url, titulo in self.paginas.values():
            if pid == pedido:
                return {"nodo": pid, "url": url, "titulo": titulo or normalize_url(url)}
        conocidos = ", ".join(pid for pid, _, _ in self.paginas.values())
        raise InvalidActionError(f"No hay una página vista con id {pedido!r}; usa uno de: {conocidos}.")

    async def _execute_step(self, name: str, action_input: dict, expectation: str) -> None:
        run = self.run
        number = len(run.steps) + 1
        page = self.session.page
        url_before, title_before = await self.session.url_and_title()
        screenshot_before = self.current_screenshot
        screenshot_before_file = run.final_screenshot

        element = None
        if name in CLICK_ACTIONS and action_input.get("coordinate") is not None:
            x, y = self.executor.resolve_coordinate(action_input.get("coordinate"))
            element = await element_at(page, x, y)
        blocked_before = await blocked_form_count(page)
        self.session.http_status = None
        self.session.events.clear()

        executed_s = self._elapsed()
        executed = await self.executor.execute(name, action_input)
        await self.session.wait_until_settled()

        self.current_screenshot = await self.session.screenshot()
        settled_s = self._elapsed()
        screenshot_file = self._save_screenshot(number, self.current_screenshot)
        url, title = await self.session.url_and_title()
        change_ratio = screen_change_ratio(screenshot_before, self.current_screenshot)

        signals: list[str] = []
        error_detail = None
        node_before, node_after = node_key(url_before, title_before), node_key(url, title)
        if executed.went_back:
            signals.append("went_back")
        elif node_after != node_before and node_after in self.visited_nodes:
            # Volver con un clic a una página ya vista: para un perfil normal es dar vueltas; un explorador lo hace a
            # propósito (regresa a un cruce o a la respuesta), así que no se cuenta como error.
            signals.append("revisit" if self.profile.explora else "went_back")
        if has_no_effect(url_before, url, change_ratio):
            signals.append("no_effect")
        error_text = await visible_error(self.session.page)
        if self.session.http_status and self.session.http_status >= 400:
            error_text = f"HTTP {self.session.http_status}" + (f": {error_text}" if error_text else "")
        if error_text:
            signals.append("visible_error")
            error_detail = error_text
        if self.session.page is page and await blocked_form_count(page) > blocked_before:
            signals.append("security_block")
        self.visited_nodes.add(node_after)
        self._registrar_pagina(url, title)

        elapsed_s = settled_s
        run.steps.append(Step(
            number=number,
            action=name,
            action_input=action_input,
            description=executed.description,
            coordinates=executed.coordinates,
            expectation=expectation,
            element=element,
            url_before=url_before,
            title_before=title_before,
            url=url,
            title=title,
            screenshot_before=screenshot_before_file,
            screenshot=screenshot_file,
            seconds_since_start=elapsed_s,
            duration_s=round(elapsed_s - self.last_step_end_s, 2),
            screen_change=round(change_ratio, 4),
            signals=signals,
            error_detail=error_detail,
            events=list(self.session.events),
            decided_s=self.decided_s,
            executed_s=executed_s,
            settled_s=settled_s,
            decided_at=self._wall(self.decided_s),
            executed_at=self._wall(executed_s),
            settled_at=self._wall(settled_s),
        ))
        run.final_screenshot = screenshot_file
        self.last_step_end_s = elapsed_s
        target = f" sobre «{element.get('text')}»" if element and element.get("text") else ""
        self._log(f"paso {number}: {executed.description}{target} -> {title!r} {signals or ''}")

    def _elapsed(self) -> float:
        return round(time.monotonic() - self.started_at, 2)

    def _wall(self, seconds: float | None) -> str:
        return "" if seconds is None else _iso(self.started_wall + timedelta(seconds=seconds))

    def _save_screenshot(self, number: int, png: bytes) -> str:
        filename = f"step_{number:02d}.png"
        (self.run_dir / filename).write_bytes(png)
        return filename
