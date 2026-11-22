"""Datos de prueba del backoffice: muchas tandas del Visitante y revisiones como las de AWS, sin llamar a Claude.

Escribe en backoffice/.mock/ (fuera de git):

    corridas/         el mismo árbol que agents/.runs/ o el bucket: tandas del Visitante y las corridas de cataloger,
                      guide e improver que enlazan las revisiones
    capturas/         una captura por estado de página; los step_NN.png de cada intento son enlaces duros a ellas
    revisiones.json   los ítems de la tabla chameleon-revisiones (los sirve mock/servir.js)

Los sitios (.test), sus páginas y los recorridos son inventados, pero pasan por las mismas piezas que los datos
reales: los perfiles y límites de visitor.profiles y visitor.config, y route_tree.json sale de
visitor.route_tree.build_route_tree. Las capturas son wireframes en PNG donde cada clic cae sobre lo que se cliqueó.

    uv run --project agents/app/visitor python backoffice/mock/generar.py [--escala 2] [--semilla 7]

Se corre desde cualquier carpeta; vuelve a generar todo desde cero cada vez (borra solo una carpeta que él creó).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shutil
import struct
import sys
import time
import unicodedata
import zlib
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus

RAIZ_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ_REPO / "agents" / "app" / "visitor"))

from visitor import config  # noqa: E402
from visitor.profiles import CONJUNTOS_EXPLORADORES, PROFILES  # noqa: E402
from visitor.route_tree import build_route_tree  # noqa: E402

SALIDA_POR_DEFECTO = RAIZ_REPO / "backoffice" / ".mock"
MARCA_DE_GENERADO = ".generado-por-mock"
TABLA = "chameleon-revisiones"

# ── Contenido de los sitios ────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Objetivo:
    id: str
    instruccion: str
    coloquial: str  # cómo lo pediría alguien sin contexto (exploradores sin_contexto)
    seccion: str
    pagina: str
    detalle: str | None  # la página final; None: la página misma
    prominencia: str  # primary (desde el inicio), secondary (también desde ayuda/FAQ) o buried (solo el camino largo)
    busqueda: str  # lo que escribe alguien común en el buscador
    termino: str  # el nombre oficial (exploradores conoce_tema)


def _o(*campos) -> Objetivo:
    return Objetivo(*campos)


RUBROS: dict[str, dict] = {
    "banco": {
        "secciones": {
            "Personas": ["Cuenta corriente", "Tarjetas de crédito", "Créditos de consumo", "Crédito hipotecario"],
            "Empresas": ["Cuenta pyme", "Factoring", "Comercio exterior"],
            "Inversiones": ["Depósitos a plazo", "Fondos mutuos", "Acciones"],
            "Ayuda": ["Bloqueo de tarjetas", "Sucursales", "Reclamos", "Seguridad"],
        },
        "objetivos": [
            _o("bloquear-tarjeta", "Encontrar cómo bloquear una tarjeta de crédito robada",
               "Me robaron la tarjeta, ¿qué hago para que no la usen?", "Ayuda", "Bloqueo de tarjetas",
               "Bloquear por robo o extravío", "primary", "bloquear tarjeta", "bloqueo de tarjeta"),
            _o("horario-sucursales", "Encontrar el horario de atención de las sucursales", "¿A qué hora abre el banco?",
               "Ayuda", "Sucursales", "Horarios de atención", "buried", "horario sucursales", "sucursales"),
            _o("simular-credito", "Simular un crédito de consumo a 24 meses",
               "Quiero saber cuánto pagaría si pido plata prestada", "Personas", "Créditos de consumo",
               "Simulador de crédito", "secondary", "simular credito", "crédito de consumo"),
            _o("tasa-hipotecario", "Averiguar la tasa del crédito hipotecario",
               "¿Cuánto cobran de interés para comprar una casa?", "Personas", "Crédito hipotecario",
               "Tasas y condiciones", "buried", "tasa hipotecario", "crédito hipotecario"),
            _o("reclamo-cobro", "Hacer un reclamo por un cobro no reconocido", "Me cobraron algo que no compré",
               "Ayuda", "Reclamos", "Cobros no reconocidos", "secondary", "cobro no reconocido",
               "desconocimiento de compra"),
        ],
    },
    "telco": {
        "secciones": {
            "Planes": ["Planes móviles", "Planes hogar", "Prepago", "Portabilidad"],
            "Equipos": ["Celulares", "Accesorios", "Ofertas"],
            "Mi cuenta": ["Boletas", "Pagar cuenta", "Cambiar plan"],
            "Soporte": ["Dar de baja", "Cobertura", "Fallas técnicas", "Roaming"],
        },
        "objetivos": [
            _o("dar-de-baja", "Encontrar cómo dar de baja un plan móvil",
               "Ya no quiero seguir con ustedes, ¿cómo me salgo?", "Soporte", "Dar de baja",
               "Requisitos para dar de baja", "buried", "dar de baja", "término de contrato"),
            _o("pagar-cuenta", "Pagar la cuenta del mes sin iniciar sesión", "Quiero pagar la cuenta rápido",
               "Mi cuenta", "Pagar cuenta", "Pago express", "primary", "pagar cuenta", "pago express"),
            _o("roaming-europa", "Averiguar cuánto cuesta el roaming en Europa",
               "Me voy de viaje a España, ¿me funciona el celular?", "Soporte", "Roaming", "Tarifas de roaming",
               "secondary", "roaming europa", "roaming internacional"),
            _o("portabilidad", "Cambiarse de compañía manteniendo el número",
               "Quiero cambiarme a ustedes sin perder mi número", "Planes", "Portabilidad", "Cómo cambiarte",
               "secondary", "portabilidad", "portabilidad numérica"),
            _o("cobertura-5g", "Revisar si hay cobertura 5G en una comuna", "¿Tienen buena señal en mi barrio?",
               "Soporte", "Cobertura", "Mapa de cobertura", "buried", "cobertura 5g", "cobertura"),
        ],
    },
    "municipio": {
        "secciones": {
            "Trámites": ["Permisos de circulación", "Patentes comerciales", "Certificados", "Licencias de conducir"],
            "Servicios": ["Retiro de residuos", "Salud municipal", "Educación"],
            "Municipio": ["Concejo municipal", "Transparencia", "Noticias"],
            "Comunidad": ["Organizaciones sociales", "Subsidios", "Deportes"],
        },
        "objetivos": [
            _o("permiso-circulacion", "Pagar el permiso de circulación en línea", "Tengo que pagar el permiso del auto",
               "Trámites", "Permisos de circulación", "Pago en línea", "primary", "permiso circulacion",
               "permiso de circulación"),
            _o("certificado-residencia", "Obtener un certificado de residencia",
               "Me piden un papel que diga dónde vivo", "Trámites", "Certificados", "Certificado de residencia",
               "buried", "certificado residencia", "certificado de residencia"),
            _o("retiro-voluminosos", "Pedir el retiro de basura voluminosa", "¿Cómo boto un sillón viejo?",
               "Servicios", "Retiro de residuos", "Retiro de voluminosos", "secondary", "retiro voluminosos",
               "residuos voluminosos"),
            _o("licencia-conducir", "Agendar hora para renovar la licencia de conducir",
               "Se me vence la licencia, ¿dónde pido hora?", "Trámites", "Licencias de conducir", "Agendar hora",
               "secondary", "licencia conducir", "licencia de conducir"),
            _o("subsidio-agua", "Postular al subsidio de agua potable", "Me cuesta pagar el agua, ¿hay alguna ayuda?",
               "Comunidad", "Subsidios", "Subsidio de agua potable", "buried", "subsidio agua",
               "subsidio de agua potable"),
        ],
    },
    "salud": {
        "secciones": {
            "Especialidades": ["Pediatría", "Traumatología", "Cardiología", "Dermatología"],
            "Pacientes": ["Agendar hora", "Resultados de exámenes", "Presupuestos", "Convenios"],
            "Urgencia": ["Urgencia adultos", "Urgencia pediátrica"],
            "Nosotros": ["Sedes", "Staff médico", "Noticias"],
        },
        "objetivos": [
            _o("agendar-hora", "Agendar una hora con un pediatra", "Mi hijo tiene fiebre, quiero que lo vea un doctor",
               "Pacientes", "Agendar hora", "Agenda en línea", "primary", "agendar hora", "agenda médica"),
            _o("resultados-examenes", "Descargar los resultados de un examen de sangre",
               "Quiero ver lo que me salió en el examen", "Pacientes", "Resultados de exámenes",
               "Descargar resultados", "secondary", "resultados examenes", "resultados de laboratorio"),
            _o("convenio-isapre", "Revisar si la clínica tiene convenio con una isapre",
               "¿Me cubre mi plan de salud aquí?", "Pacientes", "Convenios", "Isapres en convenio", "buried",
               "convenio isapre", "convenios"),
            _o("presupuesto-cirugia", "Pedir un presupuesto para una cirugía de rodilla",
               "¿Cuánto me sale operarme la rodilla?", "Pacientes", "Presupuestos", "Solicitar presupuesto",
               "buried", "presupuesto cirugia", "presupuesto quirúrgico"),
            _o("urgencia-pediatrica", "Encontrar la dirección de la urgencia pediátrica",
               "¿Dónde llevo a mi hija de urgencia?", "Urgencia", "Urgencia pediátrica", None, "secondary",
               "urgencia pediatrica", "urgencia pediátrica"),
        ],
    },
    "aerolinea": {
        "secciones": {
            "Vuelos": ["Ofertas", "Destinos", "Estado de vuelo"],
            "Mi viaje": ["Check-in", "Cambiar vuelo", "Equipaje", "Asientos"],
            "Programa": ["Acumular millas", "Canjear millas", "Categorías"],
            "Ayuda": ["Reembolsos", "Mascotas", "Asistencia especial"],
        },
        "objetivos": [
            _o("equipaje-mano", "Averiguar cuánto equipaje de mano se puede llevar",
               "¿Puedo subir con mi mochila y una maleta chica?", "Mi viaje", "Equipaje", "Equipaje de mano",
               "secondary", "equipaje de mano", "equipaje de mano"),
            _o("cambiar-vuelo", "Cambiar la fecha de un vuelo ya comprado", "Tengo que viajar otro día, ¿se puede?",
               "Mi viaje", "Cambiar vuelo", "Cambios de fecha", "primary", "cambiar vuelo", "cambio de itinerario"),
            _o("reembolso", "Pedir el reembolso de un vuelo cancelado", "Me cancelaron el vuelo y quiero mi plata",
               "Ayuda", "Reembolsos", "Solicitar reembolso", "buried", "reembolso", "reembolso"),
            _o("viajar-mascota", "Ver las condiciones para viajar con un perro en cabina",
               "Quiero llevar a mi perrita en el avión", "Ayuda", "Mascotas", "Mascotas en cabina", "buried",
               "viajar con mascota", "mascotas en cabina"),
            _o("check-in", "Hacer el check-in en línea", "¿Cómo saco la tarjeta para subir al avión?", "Mi viaje",
               "Check-in", None, "primary", "check-in", "check-in"),
        ],
    },
    "retail": {
        "secciones": {
            "Categorías": ["Tecnología", "Hogar", "Vestuario", "Deportes"],
            "Ofertas": ["Cyber", "Liquidación", "Cupones"],
            "Servicio al cliente": ["Seguimiento de pedido", "Cambios y devoluciones", "Garantías", "Despacho"],
            "Tiendas": ["Horarios", "Retiro en tienda"],
        },
        "objetivos": [
            _o("devolver-producto", "Devolver un producto comprado en línea", "Me llegó una polera que no me queda",
               "Servicio al cliente", "Cambios y devoluciones", "Cómo devolver", "secondary", "devolucion",
               "política de devoluciones"),
            _o("seguimiento-pedido", "Revisar en qué estado está un pedido", "¿Dónde está lo que compré?",
               "Servicio al cliente", "Seguimiento de pedido", None, "primary", "seguimiento pedido", "seguimiento"),
            _o("costo-despacho", "Averiguar cuánto cuesta el despacho a regiones",
               "¿Cuánto me cobran por mandarlo a Temuco?", "Servicio al cliente", "Despacho", "Costos de despacho",
               "buried", "costo despacho", "despacho a domicilio"),
            _o("garantia-extendida", "Ver qué cubre la garantía extendida de un notebook",
               "Se me echó a perder el computador, ¿me lo arreglan?", "Servicio al cliente", "Garantías",
               "Garantía extendida", "buried", "garantia", "garantía extendida"),
            _o("retiro-tienda", "Ver cómo retirar una compra en tienda", "Prefiero ir a buscarlo yo", "Tiendas",
               "Retiro en tienda", None, "secondary", "retiro en tienda", "retiro en tienda"),
        ],
    },
    "universidad": {
        "secciones": {
            "Admisión": ["Carreras", "Postulación", "Becas y créditos", "Aranceles"],
            "Estudiantes": ["Calendario académico", "Biblioteca", "Certificados", "Bienestar"],
            "Investigación": ["Centros", "Publicaciones"],
            "Extensión": ["Educación continua", "Cultura"],
        },
        "objetivos": [
            _o("arancel-carrera", "Averiguar el arancel de Ingeniería Civil", "¿Cuánto cuesta estudiar ingeniería ahí?",
               "Admisión", "Aranceles", "Aranceles por carrera", "secondary", "arancel ingenieria", "arancel"),
            _o("becas", "Ver qué becas hay para alumnos de primer año", "No me alcanza para pagar, ¿hay ayuda?",
               "Admisión", "Becas y créditos", "Becas de arancel", "secondary", "becas", "beneficios estudiantiles"),
            _o("certificado-alumno", "Descargar un certificado de alumno regular",
               "Me piden un papel que diga que estudio ahí", "Estudiantes", "Certificados",
               "Certificado de alumno regular", "buried", "certificado alumno regular",
               "certificado de alumno regular"),
            _o("calendario", "Ver cuándo empiezan las vacaciones de invierno", "¿Cuándo salimos de vacaciones?",
               "Estudiantes", "Calendario académico", None, "primary", "calendario academico",
               "calendario académico"),
            _o("diplomado", "Encontrar los diplomados en gestión", "Quiero hacer un curso corto de gestión",
               "Extensión", "Educación continua", "Diplomados", "buried", "diplomado gestion", "educación continua"),
        ],
    },
    "servicios": {
        "secciones": {
            "Hogar": ["Tarifas", "Nuevo servicio", "Eficiencia"],
            "Empresas": ["Clientes libres", "Proyectos"],
            "Atención": ["Pagar cuenta", "Cortes programados", "Emergencias", "Oficinas"],
            "Mi cuenta": ["Boleta electrónica", "Lectura del medidor", "Convenios de pago"],
        },
        "objetivos": [
            _o("cortes-programados", "Revisar si habrá un corte programado en una comuna", "¿Van a cortar la luz mañana?",
               "Atención", "Cortes programados", None, "primary", "cortes programados", "interrupciones programadas"),
            _o("convenio-pago", "Repactar una deuda en cuotas", "Debo dos meses y quiero pagar de a poco", "Mi cuenta",
               "Convenios de pago", "Repactar deuda", "buried", "convenio de pago", "convenio de pago"),
            _o("boleta-electronica", "Inscribirse en la boleta electrónica", "No quiero que me llegue el papel",
               "Mi cuenta", "Boleta electrónica", "Inscripción", "secondary", "boleta electronica",
               "boleta electrónica"),
            _o("reportar-emergencia", "Reportar una emergencia en la vía pública", "Se cayó un cable en la calle",
               "Atención", "Emergencias", "Reportar emergencia", "secondary", "emergencia", "emergencias"),
            _o("tarifas-hogar", "Ver las tarifas vigentes para el hogar", "¿Cuánto cobran por kilowatt?", "Hogar",
               "Tarifas", "Tarifas vigentes", "buried", "tarifas", "pliego tarifario"),
        ],
    },
}

SITIOS = [
    ("bancoandino.test", "Banco Andino", "banco", (11, 79, 138)),
    ("bancodelpuerto.test", "Banco del Puerto", "banco", (0, 107, 84)),
    ("telcopacifico.test", "Telco Pacífico", "telco", (214, 40, 110)),
    ("movilsur.test", "Móvil Sur", "telco", (235, 96, 10)),
    ("munilospinos.test", "Municipalidad de Los Pinos", "municipio", (31, 122, 77)),
    ("munivalleverde.test", "Municipalidad de Valle Verde", "municipio", (0, 84, 147)),
    ("clinicaaustral.test", "Clínica Austral", "salud", (0, 140, 149)),
    ("aerolineacondor.test", "Aerolínea Cóndor", "aerolinea", (91, 42, 134)),
    ("tiendavolcan.test", "Tienda Volcán", "retail", (196, 30, 36)),
    ("unilitoral.test", "Universidad del Litoral", "universidad", (44, 62, 80)),
    ("energiacordillera.test", "Energía Cordillera", "servicios", (214, 128, 0)),
    ("aguasdelmaule.test", "Aguas del Maule", "servicios", (30, 120, 200)),
]

PIE = ["Ayuda", "Preguntas frecuentes", "Mapa del sitio", "Contacto", "Trabaja con nosotros"]
DETALLES_GENERICOS = ["Requisitos", "Preguntas frecuentes", "Documentos", "Cómo funciona", "Tarifas"]
# Objetivos del catálogo que el conductor no rutea (barreras): suman realismo a goals.json.
CON_BARRERA = [
    ("ver-saldo", "Ver el saldo disponible", ["login"], "Requiere iniciar sesión."),
    ("actualizar-datos", "Actualizar los datos personales", ["personal_data"], "Pide datos personales."),
]


def slug(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    partes = "".join(c.lower() if c.isalnum() else " " for c in sin_tildes).split()
    return "-".join(partes)


# ── Sitio: páginas y enlaces ─────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Enlace:
    lugar: str  # menu, cabecera, migas, contenido, pie
    destino: str
    etiqueta: str
    forma: str = "lista"  # tarjeta o lista (solo contenido)


@dataclass
class Pagina:
    id: str  # la ruta: "/ayuda/sucursales"
    nombre: str
    tipo: str  # inicio, seccion, pagina, detalle, pie, ingreso, buscar, error
    padre: str | None = None
    seccion: str | None = None
    contenido: list[Enlace] = field(default_factory=list)


@dataclass(frozen=True)
class Estado:
    """Lo que se ve en pantalla: la página, cuánto bajó, si hay una capa abierta y la búsqueda."""

    pagina: str
    scroll: int = 0
    capa: str | None = None  # menu (móvil) o buscar
    consulta: str | None = None


class Sitio:
    def __init__(self, host: str, marca: str, rubro: str, color: tuple[int, int, int], rng: random.Random):
        self.host, self.marca, self.rubro, self.color = host, marca, rubro, color
        self.dificultad = rng.uniform(0.82, 1.1)  # sitios más o menos claros
        self.separador = rng.choice([" | ", " - ", " · "])
        self.paginas: dict[str, Pagina] = {}
        self.objetivos: dict[str, Objetivo] = {}
        self.destinos: dict[str, str] = {}  # id de objetivo → id de página final
        self._distancias: dict[str, dict[str, int]] = {}
        self._armar(rng)

    def _agregar(self, id_: str, nombre: str, tipo: str, padre: str | None = None, seccion: str | None = None) -> Pagina:
        if id_ not in self.paginas:
            self.paginas[id_] = Pagina(id_, nombre, tipo, padre, seccion)
        return self.paginas[id_]

    def _armar(self, rng: random.Random) -> None:
        datos = RUBROS[self.rubro]
        inicio = self._agregar("/", "Inicio", "inicio")
        secciones = []
        for seccion, paginas in datos["secciones"].items():
            s = self._agregar(f"/{slug(seccion)}", seccion, "seccion", "/", seccion)
            secciones.append(s)
            for nombre in paginas:
                p = self._agregar(f"{s.id}/{slug(nombre)}", nombre, "pagina", s.id, seccion)
                s.contenido.append(Enlace("contenido", p.id, nombre, "tarjeta"))
        for obj in datos["objetivos"]:
            pagina = self.paginas[f"/{slug(obj.seccion)}/{slug(obj.pagina)}"]
            destino = pagina
            if obj.detalle:
                destino = self._agregar(f"{pagina.id}/{slug(obj.detalle)}", obj.detalle, "detalle", pagina.id,
                                        obj.seccion)
                pagina.contenido.append(Enlace("contenido", destino.id, obj.detalle, "tarjeta"))
            self.objetivos[obj.id] = obj
            self.destinos[obj.id] = destino.id
        for pagina in [p for p in self.paginas.values() if p.tipo == "pagina"]:
            for nombre in rng.sample(DETALLES_GENERICOS, rng.randint(0, 2)):
                if f"{pagina.id}/{slug(nombre)}" in self.paginas:
                    continue
                d = self._agregar(f"{pagina.id}/{slug(nombre)}", nombre, "detalle", pagina.id, pagina.seccion)
                pagina.contenido.append(Enlace("contenido", d.id, nombre, "tarjeta"))
            hermanas = [p for p in self.paginas.values() if p.tipo == "pagina" and p.padre == pagina.padre
                        and p.id != pagina.id]
            for h in rng.sample(hermanas, min(2, len(hermanas))):
                pagina.contenido.append(Enlace("contenido", h.id, h.nombre))
        for detalle in [p for p in self.paginas.values() if p.tipo == "detalle"]:
            hermanas = [p for p in self.paginas.values() if p.tipo == "detalle" and p.padre == detalle.padre
                        and p.id != detalle.id]
            detalle.contenido += [Enlace("contenido", h.id, h.nombre) for h in hermanas[:3]]
            padre = self.paginas[detalle.padre]
            detalle.contenido.append(Enlace("contenido", padre.id, f"Volver a {padre.nombre}"))

        # Pie: si ya hay una sección con el mismo nombre (Ayuda), el pie lleva a ella.
        self.pie = []
        for nombre in PIE:
            id_ = f"/{slug(nombre)}"
            pagina = self.paginas.get(id_) or self._agregar(id_, nombre, "pie", "/")
            self.pie.append(Enlace("pie", pagina.id, nombre))
        self._agregar("/ingresar", "Ingresar", "ingreso", "/")
        self._agregar("/buscar", "Resultados de búsqueda", "buscar")

        destinos = {o.id: self.paginas[self.destinos[o.id]] for o in self.objetivos.values()}
        primarios = [destinos[o.id] for o in self.objetivos.values() if o.prominencia == "primary"]
        relleno = [p for p in self.paginas.values() if p.tipo == "pagina" and p not in primarios]
        for p in primarios + rng.sample(relleno, max(0, 6 - len(primarios))):
            inicio.contenido.append(Enlace("contenido", p.id, p.nombre, "tarjeta"))
        visibles = [destinos[o.id] for o in self.objetivos.values() if o.prominencia != "buried"]
        otros = [p for p in self.paginas.values() if p.tipo == "detalle" and p not in visibles]
        for id_ in ("/preguntas-frecuentes", "/ayuda"):
            if pagina := self.paginas.get(id_):
                for d in visibles + rng.sample(otros, min(3, len(otros))):
                    if Enlace("contenido", d.id, d.nombre) not in pagina.contenido:
                        pagina.contenido.append(Enlace("contenido", d.id, d.nombre))
        mapa = self.paginas["/mapa-del-sitio"]
        for s in secciones:
            mapa.contenido.append(Enlace("contenido", s.id, s.nombre))
            mapa.contenido += [Enlace("contenido", p.id, p.nombre) for p in self.paginas.values()
                               if p.tipo == "pagina" and p.padre == s.id]
        self.menu = [Enlace("menu", s.id, s.nombre) for s in secciones]
        self.cabecera = [Enlace("cabecera", "/", self.marca), Enlace("cabecera", "/ingresar", "Ingresar")]

    # Lo que se ve de una página

    def url(self, estado: Estado) -> str:
        ruta = estado.pagina.removeprefix("404:")
        consulta = f"?q={quote_plus(estado.consulta)}" if estado.consulta else ""
        return f"https://www.{self.host}{ruta}{consulta}"

    def nombre(self, estado: Estado) -> str:
        if estado.pagina.startswith("404:"):
            return "Página no encontrada"
        if estado.pagina == "/buscar":
            return f"Resultados para «{estado.consulta}»"
        return self.paginas[estado.pagina].nombre

    def titulo(self, estado: Estado) -> str:
        if estado.pagina == "/":
            return self.marca if self.separador == " · " else f"Inicio{self.separador}{self.marca}"
        nombre = "Resultados de búsqueda" if estado.pagina == "/buscar" else self.nombre(estado)
        return f"{nombre}{self.separador}{self.marca}"

    def tipo(self, estado: Estado) -> str:
        return "error" if estado.pagina.startswith("404:") else self.paginas[estado.pagina].tipo

    def ancestros(self, id_: str) -> list[Pagina]:
        cadena, actual = [], self.paginas[id_].padre
        while actual:
            cadena.append(self.paginas[actual])
            actual = self.paginas[actual].padre
        return cadena[::-1]

    def contenido(self, estado: Estado) -> list[Enlace]:
        if estado.pagina.startswith("404:"):
            return [Enlace("contenido", "/", "Volver al inicio")]
        if estado.pagina == "/buscar":
            return self.resultados(estado.consulta or "")
        return self.paginas[estado.pagina].contenido

    def enlaces(self, estado: Estado) -> list[Enlace]:
        """Todos los enlaces de la página, estén o no a la vista."""
        migas = [] if estado.pagina.startswith("404:") or not self.paginas[estado.pagina].padre else [
            Enlace("migas", a.id, a.nombre) for a in self.ancestros(estado.pagina)]
        return [*self.menu, *self.cabecera, *migas, *self.contenido(estado), *self.pie]

    def resultados(self, consulta: str) -> list[Enlace]:
        """Los resultados del buscador, siempre los mismos para la misma consulta."""
        rng = random.Random(f"{self.host}|{consulta}")
        palabras = set(slug(consulta).split("-"))
        encontrados = []
        for obj in self.objetivos.values():
            if consulta == obj.termino.lower():
                p = 0.92
            elif consulta == obj.busqueda.lower():
                p = 0.85
            elif palabras & set(slug(f"{obj.busqueda} {obj.termino} {obj.detalle or obj.pagina}").split("-")):
                p = 0.4
            else:
                continue
            if rng.random() < p:
                encontrados.append(self.paginas[self.destinos[obj.id]])
        relleno = [p for p in self.paginas.values() if p.tipo in ("pagina", "detalle") and p not in encontrados]
        resultado = rng.sample(relleno, rng.randint(3, 5))
        for p in encontrados:
            resultado.insert(rng.randint(0, min(2, len(resultado))), p)
        return [Enlace("contenido", p.id, p.nombre) for p in resultado]

    def distancias(self, destino: str) -> dict[str, int]:
        """Clics mínimos desde cada página hasta `destino` (sin el buscador)."""
        if destino not in self._distancias:
            entrantes: dict[str, set[str]] = {}
            for id_ in self.paginas:
                if id_ == "/buscar":
                    continue
                for e in self.enlaces(Estado(id_)):
                    entrantes.setdefault(e.destino, set()).add(id_)
            dist, cola = {destino: 0}, deque([destino])
            while cola:
                actual = cola.popleft()
                for origen in entrantes.get(actual, ()):
                    if origen not in dist:
                        dist[origen] = dist[actual] + 1
                        cola.append(origen)
            self._distancias[destino] = dist
        return self._distancias[destino]


# ── Diseño de la página y capturas en PNG ────────────────────────────────────────────────────────────────────────

VISTAS = {"desktop": (1024, 768), "mobile": (390, 844)}
FONDO = (244, 245, 247)
BLANCO = (255, 255, 255)
TEXTO = (31, 41, 51)
GRIS = (203, 210, 217)
GRIS_SUAVE = (230, 233, 237)
PIE_FONDO = (36, 44, 56)
PIE_TEXTO = (150, 160, 172)
ENLACE = (37, 99, 235)
ROJO = (220, 53, 69)


def aclarar(c, f):
    return tuple(int(v + (255 - v) * f) for v in c)


def oscurecer(c, f):
    return tuple(int(v * (1 - f)) for v in c)


@dataclass(frozen=True)
class Ubicado:
    lugar: str  # los de Enlace, más hamburguesa y buscador (sin destino)
    destino: str | None
    etiqueta: str
    caja: tuple[int, int, int, int]  # x0, y0, x1, y1: en el documento, o en la pantalla si es fijo
    fijo: bool


@dataclass
class Diseno:
    ancho: int
    alto: int
    cabecera: int
    alto_doc: int
    fijos: list
    doc: list
    ubicados: list[Ubicado]

    def max_scroll(self) -> int:
        return max(0, self.alto_doc - self.alto)

    def visible(self, u: Ubicado, scroll: int) -> bool:
        return u.fijo or (u.caja[1] - scroll >= self.cabecera + 4 and u.caja[3] - scroll <= self.alto - 4)

    def buscar(self, lugar: str, destino: str | None = None) -> Ubicado | None:
        return next((u for u in self.ubicados if u.lugar == lugar and (destino is None or u.destino == destino)), None)


def disenar(sitio: Sitio, estado: Estado, vista: str) -> Diseno:
    W, H = VISTAS[vista]
    movil = vista == "mobile"
    c = sitio.color
    fijos, doc, ubicados = [], [], []

    def ubicar(lugar, destino, etiqueta, caja, fijo=False):
        ubicados.append(Ubicado(lugar, destino, etiqueta, tuple(int(v) for v in caja), fijo))

    hh = 56 if movil else 64
    fijos.append((0, 0, W, hh, c))
    logo = (16, 14, 124, 42) if movil else (24, 16, 168, 48)
    fijos.append((*logo, aclarar(c, 0.35)))
    ubicar("cabecera", "/", sitio.marca, logo, True)
    if movil:
        lupa = (W - 96, 14, W - 64, 42)
        fijos.append((*lupa, aclarar(c, 0.55)))
        ubicar("buscador", None, "Buscar", lupa, True)
        ham = (W - 52, 14, W - 16, 42)
        fijos += [(ham[0] + 6, ham[1] + 5 + i * 8, ham[2] - 6, ham[1] + 9 + i * 8, BLANCO) for i in range(3)]
        ubicar("hamburguesa", None, "Menú", ham, True)
    else:
        x = 196  # el menú cabe entre el logo y el buscador (W - 318)
        for e in sitio.menu:
            w = min(100, 6 * len(e.etiqueta) + 14)
            fijos.append((x, hh // 2 - 6, x + w, hh // 2 + 6, aclarar(c, 0.75)))
            ubicar("menu", e.destino, e.etiqueta, (x - 8, hh // 2 - 16, x + w + 8, hh // 2 + 16), True)
            x += w + 18
        caja = (W - 318, 16, W - 150, 48)
        if estado.capa == "buscar":
            fijos.append((caja[0] - 3, caja[1] - 3, caja[2] + 3, caja[3] + 3, ENLACE))
        fijos += [(*caja, BLANCO), (caja[0] + 10, 28, caja[0] + 22, 36, GRIS)]
        if estado.capa == "buscar":
            fijos.append((caja[0] + 30, 27, caja[0] + 110, 37, TEXTO))
        ubicar("buscador", None, "Buscar", caja, True)
        ingresar = (W - 136, 16, W - 24, 48)
        fijos += [(*ingresar, oscurecer(c, 0.3)), (W - 112, 28, W - 48, 36, aclarar(c, 0.8))]
        ubicar("cabecera", "/ingresar", "Ingresar", ingresar, True)
    if movil and estado.capa == "buscar":
        fijos += [(0, hh, W, hh + 60, BLANCO), (0, hh + 59, W, hh + 60, GRIS), (12, hh + 12, W - 12, hh + 48, ENLACE),
                  (14, hh + 14, W - 14, hh + 46, GRIS_SUAVE), (24, hh + 25, 140, hh + 35, TEXTO)]
    if movil and estado.capa == "menu":
        fijos.append((0, hh, W, H, BLANCO))
        y = hh + 12
        for e in [*sitio.menu, Enlace("cabecera", "/ingresar", "Ingresar")]:
            caja = (12, y, W - 12, y + 44)
            fijos += [(*caja, GRIS_SUAVE), (28, y + 16, 28 + min(W - 80, 8 * len(e.etiqueta)), y + 28, TEXTO)]
            ubicar(e.lugar, e.destino, e.etiqueta, caja, True)
            y += 56
        return Diseno(W, H, hh, H, fijos, [], ubicados)

    m = 16 if movil else 32
    util = W - 2 * m
    gen = random.Random(f"{sitio.host}{estado.pagina}{estado.consulta}")
    tipo = sitio.tipo(estado)
    y = hh + 20 + (60 if movil and estado.capa == "buscar" else 0)

    def lineas(n, y, x=m, ancho=util, color=GRIS):
        for _ in range(n):
            doc.append((x, y, x + int(ancho * gen.uniform(0.55, 0.98)), y + 9, color))
            y += 20
        return y

    if tipo not in ("error", "buscar", "inicio") and sitio.paginas[estado.pagina].padre:
        x = m
        for anc in sitio.ancestros(estado.pagina):
            w = 6 * len(anc.nombre) + 10
            if x + w > W - m:
                break
            doc.append((x, y, x + w, y + 10, aclarar(ENLACE, 0.35)))
            ubicar("migas", anc.id, anc.nombre, (x - 4, y - 6, x + w + 4, y + 16))
            x += w + 20
        y += 30
    nombre = sitio.nombre(estado)
    doc.append((m, y, m + max(120, min(util, 13 * len(nombre) + 24)), y + (20 if movil else 26), TEXTO))
    y += 52

    if tipo == "inicio":
        alto = 180 if movil else 230
        doc += [(m, y, W - m, y + alto, aclarar(c, 0.82)), (m + 24, y + 40, m + min(util - 48, 420), y + 64,
                                                            oscurecer(c, 0.2)),
                (m + 24, y + 84, m + min(util - 48, 360), y + 96, GRIS), (m + 24, y + alto - 64, m + 180,
                                                                         y + alto - 24, c)]
        y += alto + 32
    elif tipo == "error":
        doc += [(m, y, m + 220, y + 100, aclarar(ROJO, 0.75)), (m + 20, y + 30, m + 180, y + 70, ROJO)]
        y = lineas(2, y + 130)
    elif tipo == "ingreso":
        x0 = (W - min(360, util)) // 2
        x1 = W - x0
        doc += [(x0, y, x1, y + 300, BLANCO), (x0 + 24, y + 40, x1 - 24, y + 84, GRIS_SUAVE),
                (x0 + 24, y + 110, x1 - 24, y + 154, GRIS_SUAVE), (x0 + 24, y + 200, x1 - 24, y + 248, c)]
        y += 340
    elif tipo == "buscar":
        y = lineas(1, y) + 12
    else:
        y = lineas({"seccion": 3, "pagina": 5, "detalle": 6, "pie": 4}.get(tipo, 3), y) + 16
        if tipo == "detalle":
            doc.append((m, y, W - m, y + 110, aclarar(c, 0.88)))
            lineas(3, y + 24, m + 20, util - 40, aclarar(c, 0.45))
            y = lineas(5, y + 140) + 12
            doc.append((m, y, m + 210, y + 44, c))
            y += 76

    contenido = sitio.contenido(estado)
    tarjetas = [e for e in contenido if e.forma == "tarjeta"]
    listas = [e for e in contenido if e.forma == "lista"]
    if tarjetas:
        cols, gap = (1, 16) if movil else (3, 24)
        cw = (util - gap * (cols - 1)) // cols
        ch = 120 if movil else 170
        for i, e in enumerate(tarjetas):
            x0, y0 = m + (i % cols) * (cw + gap), y + (i // cols) * (ch + gap)
            tinte = aclarar(c, 0.45 + 0.4 * random.Random(e.destino).random())
            doc += [(x0 - 1, y0 - 1, x0 + cw + 1, y0 + ch + 1, GRIS), (x0, y0, x0 + cw, y0 + ch, BLANCO),
                    (x0, y0, x0 + cw, y0 + ch // 2, tinte),
                    (x0 + 14, y0 + ch // 2 + 16, x0 + 14 + min(cw - 28, 8 * len(e.etiqueta) + 10), y0 + ch // 2 + 28,
                     TEXTO), (x0 + 14, y0 + ch // 2 + 40, x0 + int(cw * 0.7), y0 + ch // 2 + 48, GRIS)]
            ubicar("contenido", e.destino, e.etiqueta, (x0, y0, x0 + cw, y0 + ch))
        y += -(-len(tarjetas) // cols) * (ch + gap) + 16
    alto_fila = 76 if tipo == "buscar" else 40
    for e in listas:
        w = min(util, 8 * len(e.etiqueta) + 20)
        doc.append((m, y + 12, m + w, y + 24, ENLACE))
        if tipo == "buscar":
            doc += [(m, y + 36, m + int(util * gen.uniform(0.6, 0.95)), y + 44, GRIS),
                    (m, y + 52, m + int(util * gen.uniform(0.4, 0.8)), y + 60, GRIS)]
        ubicar("contenido", e.destino, e.etiqueta, (m, y + 2, m + w, y + 34))
        y += alto_fila

    y += 40
    alto_pie = max(40 + len(sitio.pie) * 44 if movil else 170, H - y)  # en una página corta, el pie llega abajo
    doc.append((0, y, W, y + alto_pie, PIE_FONDO))
    for i, e in enumerate(sitio.pie):
        w = 7 * len(e.etiqueta)
        x0, y0 = (m, y + 28 + i * 44) if movil else (m + i * (util // len(sitio.pie)), y + 48)
        doc.append((x0, y0, x0 + w, y0 + 10, PIE_TEXTO))
        ubicar("pie", e.destino, e.etiqueta, (x0 - 4, y0 - 10, x0 + w + 4, y0 + 20))
    return Diseno(W, H, hh, max(H, y + alto_pie), fijos, doc, ubicados)


def png(ancho: int, alto: int, rects: list) -> bytes:
    """PNG RGB de rectángulos de color pintados en orden, sobre el fondo."""
    recortados = []
    for x0, y0, x1, y1, color in rects:
        x0, x1 = max(0, min(ancho, x0)), max(0, min(ancho, x1))
        y0, y1 = max(0, min(alto, y0)), max(0, min(alto, y1))
        if x1 > x0 and y1 > y0:
            recortados.append((x0, y0, x1, y1, bytes(color)))
    cortes = sorted({0, alto, *(r[1] for r in recortados), *(r[3] for r in recortados)})
    crudo = bytearray()
    for a, b in zip(cortes, cortes[1:]):
        fila = bytearray(bytes(FONDO) * ancho)
        for x0, y0, x1, y1, color in recortados:
            if y0 <= a and y1 >= b:
                fila[x0 * 3:x1 * 3] = color * (x1 - x0)
        crudo += (b"\x00" + fila) * (b - a)

    def bloque(tipo: bytes, datos: bytes) -> bytes:
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))

    return (b"\x89PNG\r\n\x1a\n" + bloque(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0))
            + bloque(b"IDAT", zlib.compress(bytes(crudo), 6)) + bloque(b"IEND", b""))


class Capturas:
    """Una captura por (sitio, vista, estado): los intentos las enlazan en vez de copiarlas."""

    def __init__(self, carpeta: Path, dibujar: bool):
        self.carpeta, self.dibujar = carpeta, dibujar
        self.rutas: dict[tuple, Path] = {}
        self.minima = png(1, 1, [])

    def ruta(self, sitio: Sitio, estado: Estado, vista: str) -> Path:
        clave = (sitio.host, vista, estado)
        if clave not in self.rutas:
            if not self.dibujar:
                ruta = self.carpeta / "vacia.png"
                if not ruta.exists():
                    ruta.parent.mkdir(parents=True, exist_ok=True)
                    ruta.write_bytes(self.minima)
            else:
                nombre = hashlib.sha1(repr(clave).encode()).hexdigest()[:16]
                ruta = self.carpeta / sitio.host / vista / f"{nombre}.png"
                ruta.parent.mkdir(parents=True, exist_ok=True)
                d = disenar(sitio, estado, vista)
                rects = [(x0, y0 - estado.scroll, x1, y1 - estado.scroll, col) for x0, y0, x1, y1, col in d.doc]
                ruta.write_bytes(png(d.ancho, d.alto, rects + d.fijos))
            self.rutas[clave] = ruta
        return self.rutas[clave]


def enlazar(origen: Path, destino: Path) -> None:
    try:
        os.link(origen, destino)
    except OSError:
        shutil.copyfile(origen, destino)


# ── Intentos simulados ───────────────────────────────────────────────────────────────────────────────────────────

# Perfiles retirados que siguen en tandas viejas: (nombre, vista, habilidad, ritmo, paciencia).
ANTIGUOS = {
    "first_time": ("Primera vez", "desktop", 0.56, 1.0, (9, 14)),
    "hurried": ("Apurado", "desktop", 0.5, 0.7, (6, 10)),
    "mobile": ("Móvil", "mobile", 0.5, 1.15, (9, 14)),
    "senior": ("Adulto mayor", "desktop", 0.38, 1.7, (10, 15)),
}
PROMINENCIA = {"primary": 1.15, "secondary": 1.0, "buried": 0.8}
ERRORES = {
    "internal_error": "Error: Page.screenshot: Timeout 30000ms exceeded.\nCall log:\n  - taking page screenshot\n"
                      "  - waiting for fonts to load...",
    "api_error": "Error code: 529 - {'type': 'error', 'error': {'type': 'overloaded_error', 'message': 'Overloaded'}}",
    "no_response": "El modelo no respondió en 120 s.",
    "refusal": "El modelo se negó a seguir con la tarea.",
}
EXPECTATIVAS = {
    "clic": ["Ver {e}.", "Entrar a {e} para buscar lo que pide la tarea.", "Que se abra {e}.",
             "Encontrar la información en {e}.", "Que {e} lleve a lo que busco."],
    "scroll": ["Ver más opciones más abajo.", "Revisar el resto de la página.", "Buscar un enlace relacionado.",
               "Llegar al pie de página."],
    "sin_efecto": ["Que se abra la información.", "Que se despliegue más detalle."],
}


class Simulador:
    def __init__(self, sitio: Sitio, objetivo: Objetivo, inicio: str, vista: str, rng: random.Random, *,
                 habilidad: float, ritmo: float, paciencia: int, limite: int, explora: bool = False,
                 primera_rama: str | None = None, conocimiento: str | None = None):
        self.s, self.obj, self.vista, self.rng = sitio, objetivo, vista, rng
        self.destino = sitio.destinos[objetivo.id]
        self.dist = sitio.distancias(self.destino)
        self.habilidad = max(0.12, min(0.95, habilidad * PROMINENCIA[objetivo.prominencia] * sitio.dificultad))
        self.ritmo, self.paciencia, self.limite = ritmo, paciencia, limite
        self.explora, self.primera_rama, self.conocimiento = explora, primera_rama, conocimiento
        self.estado = Estado(inicio)
        self.estados = [self.estado]
        self.historial = [self.estado]
        self.vistas = {inicio}
        self.pasos: list[dict] = []
        self.t = 0.0
        self.fin: str | None = None
        self.mejor = self.distancia(self.estado)
        self.error_en = rng.randint(0, limite - 1) if rng.random() < 0.035 else None

    # Medidas

    def distancia(self, estado: Estado) -> int:
        if estado.pagina in self.dist:
            return self.dist[estado.pagina]
        return 1 + min((self.dist.get(e.destino, 99) for e in self.s.enlaces(estado)), default=99)

    def plausible(self, estado: Estado) -> bool:
        """Una página donde alguien podría creer que terminó sin haber llegado."""
        tipo = self.s.tipo(estado)
        return tipo in ("detalle", "pagina") and self.s.paginas[estado.pagina].seccion == self.obj.seccion

    # Pasos

    def _paso(self, accion, entrada, descripcion, coords, elemento, nuevo: Estado, expectativa, dt, cambio,
              senales=()):
        antes = self.estado
        n = len(self.pasos) + 1
        if self.rng.random() < 0.04:
            dt += self.rng.uniform(8, 22)  # una duda larga: demoras en el backoffice
        self.t += dt * self.ritmo
        self.pasos.append({
            "number": n,
            "action": accion,
            "action_input": entrada,
            "description": descripcion,
            "coordinates": coords,
            "expectation": expectativa,
            "element": elemento,
            "url_before": self.s.url(antes),
            "title_before": self.s.titulo(antes),
            "url": self.s.url(nuevo),
            "title": self.s.titulo(nuevo),
            "screenshot_before": f"step_{n - 1:02d}.png",
            "screenshot": f"step_{n:02d}.png",
            "seconds_since_start": round(self.t, 1),
            "duration_s": round(dt * self.ritmo, 1),
            "screen_change": round(cambio, 2),
            "signals": list(senales),
            "error_detail": None,
            "events": [],
        })
        self.estado = nuevo
        self.estados.append(nuevo)

    def desplazar(self, direccion: str, cantidad: int) -> None:
        d = disenar(self.s, self.estado, self.vista)
        delta = cantidad * 80 * (1 if direccion == "down" else -1)
        scroll = max(0, min(d.max_scroll(), self.estado.scroll + delta))
        movio = scroll != self.estado.scroll
        nuevo = Estado(self.estado.pagina, scroll, None, self.estado.consulta)
        self._paso("scroll", {"scroll_direction": direccion, "scroll_amount": cantidad},
                   f"scroll {direccion} x{cantidad}", [d.ancho // 2, d.alto // 2], None, nuevo,
                   self.rng.choice(EXPECTATIVAS["scroll"]), self.rng.uniform(1.0, 2.6),
                   self.rng.uniform(0.15, 0.45) if movio else 0.0, () if movio else ("no_effect",))

    def _clic(self, u: Ubicado, nuevo: Estado, expectativa: str, cambio: float, senales=(), elemento=None):
        x0, y0, x1, y1 = u.caja
        dy = 0 if u.fijo else self.estado.scroll
        x = int((x0 + x1) / 2 + self.rng.uniform(-0.25, 0.25) * (x1 - x0))
        y = int((y0 + y1) / 2 - dy + self.rng.uniform(-0.2, 0.2) * (y1 - y0))
        if elemento is None:
            elemento = {"tag": "a", "text": u.etiqueta, "role": None, "href": u.destino, "type": None, "id": None}
        self._paso("left_click", {"coordinate": [x, y]}, f"clic en ({x}, {y})", [x, y], elemento, nuevo,
                   expectativa, self.rng.uniform(1.8, 5.0), cambio, senales)

    def ir(self, e: Enlace) -> None:
        """Cliquea `e`; si no está dibujado (migas que no caben), baja en la página: siempre deja al menos un paso."""
        if not self._ir(e):
            self.desplazar("down", 3)

    def _ir(self, e: Enlace) -> bool:
        """Hace lo necesario para cliquear `e` en la pantalla: abrir el menú, bajar hasta verlo, y el clic."""
        d = disenar(self.s, self.estado, self.vista)
        u = d.buscar(e.lugar, e.destino)
        if u is None and self.vista == "mobile" and e.lugar in ("menu", "cabecera"):
            ham = d.buscar("hamburguesa")
            self._clic(ham, Estado(self.estado.pagina, self.estado.scroll, "menu", self.estado.consulta),
                       "Abrir el menú para ver las secciones.", self.rng.uniform(0.4, 0.7),
                       elemento={"tag": "button", "text": "Menú", "role": "button", "href": None, "type": None,
                                 "id": None})
            d = disenar(self.s, self.estado, self.vista)
            u = d.buscar(e.lugar, e.destino)
        if u is None:
            return False
        for _ in range(12):
            if d.visible(u, self.estado.scroll):
                break
            abajo = u.caja[3] - self.estado.scroll > d.alto
            antes = self.estado.scroll
            self.desplazar("down" if abajo else "up", self.rng.choice([3, 5, 5, 10]))
            if self.estado.scroll == antes:
                break
        if self.rng.random() < 0.025 and e.destino not in ("/", self.destino) and self.s.paginas[e.destino].tipo \
                in ("pagina", "detalle"):
            nuevo, senales, cambio = Estado(f"404:{e.destino}"), ("visible_error",), self.rng.uniform(0.6, 0.9)
        else:
            nuevo, senales, cambio = Estado(e.destino), (), self.rng.uniform(0.5, 0.95)
        if self.explora and nuevo.pagina in self.vistas:
            senales = (*senales, "revisit")
        self._clic(u, nuevo, self.rng.choice(EXPECTATIVAS["clic"]).format(e=f"«{e.etiqueta}»"), cambio, senales)
        self.vistas.add(nuevo.pagina)
        self.historial.append(nuevo)
        return True

    def clic_sin_efecto(self) -> None:
        d = disenar(self.s, self.estado, self.vista)
        cajas = [r for r in d.doc if d.cabecera < r[1] - self.estado.scroll < d.alto - 40 and r[4] in (TEXTO, GRIS)]
        if not cajas:
            return
        x0, y0, x1, y1, _ = self.rng.choice(cajas)
        u = Ubicado("contenido", None, self.s.nombre(self.estado), (x0, y0, x1, y1), False)
        self._clic(u, self.estado, self.rng.choice(EXPECTATIVAS["sin_efecto"]), 0.0, ("no_effect",),
                   {"tag": "div", "text": self.s.nombre(self.estado), "role": None, "href": None, "type": None,
                    "id": None})

    def buscar(self, consulta: str) -> None:
        d = disenar(self.s, self.estado, self.vista)
        caja = d.buscar("buscador")
        self._clic(caja, Estado(self.estado.pagina, self.estado.scroll, "buscar", self.estado.consulta),
                   "Escribir en el buscador.", self.rng.uniform(0.03, 0.12),
                   elemento={"tag": "input", "text": None, "role": "searchbox", "href": None, "type": "search",
                             "id": "q"})
        self._paso("type", {"text": consulta}, f"escribir «{consulta}»", None, None, self.estado,
                   "Que el buscador muestre resultados.", self.rng.uniform(2.5, 6.0), 0.03)
        nuevo = Estado("/buscar", 0, None, consulta)
        self._paso("key", {"text": "Return"}, "tecla Return", None, None, nuevo, "Ver los resultados de la búsqueda.",
                   self.rng.uniform(1.0, 2.5), self.rng.uniform(0.6, 0.9))
        self.vistas.add("/buscar")
        self.historial.append(nuevo)

    def atras(self) -> bool:
        if len(self.historial) < 2:
            return False
        self.historial.pop()
        anterior = self.historial[-1]
        self._paso("key", {"text": "alt+Left"}, "atrás", None, None, Estado(anterior.pagina, 0, None,
                                                                               anterior.consulta),
                   "Volver a la página anterior.", self.rng.uniform(1.0, 2.2), self.rng.uniform(0.5, 0.9),
                   ("went_back",))
        return True

    def saltar(self, destino: Estado) -> None:
        titulo = self.s.titulo(destino)
        self._paso("volver_a_nodo", {"titulo": titulo}, f"volver a «{titulo}»", None, None,
                   Estado(destino.pagina, 0, None, destino.consulta), "Abrir otra rama desde una página ya vista.",
                   self.rng.uniform(1.0, 2.0), self.rng.uniform(0.5, 0.9))
        self.historial.append(self.estado)

    def elegir(self, enlaces: list[Enlace]) -> Enlace:
        pesos = {"contenido": 3.0, "menu": 1.6 if self.vista == "mobile" else 2.5, "migas": 0.8, "pie": 0.9}
        return self.rng.choices(enlaces, [pesos.get(e.lugar, 0.25 if e.destino == "/ingresar" else 0.5)
                                          for e in enlaces])[0]

    def termino_de_busqueda(self) -> str:
        if self.conocimiento == "conoce_tema":
            return self.obj.termino.lower()
        if self.conocimiento == "sin_contexto":
            palabras = [p for p in slug(self.obj.coloquial).split("-") if len(p) > 3]
            return " ".join(palabras[:3]) or self.obj.busqueda
        return self.obj.busqueda

    # Recorridos

    def recorrer(self) -> None:
        while len(self.pasos) < self.limite:
            if self.error_en is not None and len(self.pasos) >= self.error_en:
                self.fin = self.rng.choices(list(ERRORES), [5, 4, 2, 0.4])[0]
                return
            if self.estado.pagina == self.destino:
                if self.rng.random() < 0.4:
                    self.desplazar("down", self.rng.choice([3, 5]))
                self.fin = "done"
                return
            if len(self.pasos) >= self.paciencia and self.rng.random() < 0.35:
                break
            if self.plausible(self.estado) and self.rng.random() < 0.45 * (1 - self.habilidad):
                self.fin = "done"
                return
            d = self.distancia(self.estado)
            self.mejor = min(self.mejor, d)
            perdido = d > self.mejor or self.s.tipo(self.estado) in ("error", "ingreso")
            if perdido and self.rng.random() < 0.55 and self.atras():
                continue
            if self.rng.random() < 0.06:
                self.clic_sin_efecto()
                continue
            enlaces = [e for e in self.s.enlaces(self.estado) if e.destino != self.estado.pagina]
            buenos = [e for e in enlaces if self.dist.get(e.destino, 99) < d]
            if buenos and self.rng.random() < self.habilidad:
                self.ir(self.elegir(buenos))
            elif self.estado.pagina != "/buscar" and self.rng.random() < 0.12:
                self.buscar(self.termino_de_busqueda())
            else:
                self.ir(self.elegir([e for e in enlaces if e not in buenos] or enlaces))
        self.fin = "gave_up"

    def explorar(self) -> None:
        """Como la skill explorar-caminos: abre una rama por cada lugar de la página inicial y vuelve con saltos."""
        lugares = [self.primera_rama, *(lg for lg in ("menu", "buscador", "pie", "contenido")
                                        if lg != self.primera_rama)]
        inicio, encontro = self.estado, False
        for lugar in lugares:
            if len(self.pasos) >= self.limite - 3:
                break
            if self.estado.pagina != inicio.pagina:
                self.saltar(inicio)
            if lugar == "buscador":
                self.buscar(self.termino_de_busqueda())
            else:
                opciones = [e for e in self.s.enlaces(self.estado) if e.lugar == lugar]
                buenos = [e for e in opciones if self.dist.get(e.destino, 99) < self.distancia(self.estado)]
                self.ir(self.rng.choice(buenos if buenos and self.rng.random() < self.habilidad else opciones))
            for _ in range(self.rng.randint(1, 4)):
                if len(self.pasos) >= self.limite - 2 or self.estado.pagina == self.destino:
                    break
                if self.error_en is not None and len(self.pasos) >= self.error_en:
                    self.fin = self.rng.choices(list(ERRORES), [5, 4, 2, 0.4])[0]
                    return
                if self.rng.random() < 0.3:
                    self.desplazar("down", self.rng.choice([5, 10]))
                rama = [e for e in self.s.enlaces(self.estado) if e.lugar in ("contenido", "migas")
                        and e.destino != self.estado.pagina] or self.s.enlaces(self.estado)
                buenos = [e for e in rama if self.dist.get(e.destino, 99) < self.distancia(self.estado)]
                self.ir(self.rng.choice(buenos) if buenos and self.rng.random() < self.habilidad
                        else self.elegir(rama))
            if self.estado.pagina == self.destino:
                encontro = True
                if self.rng.random() < 0.7:
                    self.fin = "done"
                    return
        if encontro:
            self.saltar(Estado(self.destino))
            self.fin = "done"
        elif self.plausible(self.estado) and self.rng.random() < 0.4:
            self.fin = "done"
        else:
            self.fin = "gave_up"


def intento(sitio: Sitio, objetivo: Objetivo, inicio: str, perfil: str, rng: random.Random, *, estilo: str,
            repeticion: int = 1, comienzo: datetime, con_ruta: bool = True) -> tuple[dict, list[Estado], str]:
    """Un run.json simulado. `estilo`: ruta (recorrido único del flujo de AWS), juez (exploradores) o antiguo."""
    conocimiento = None
    if estilo == "antiguo":
        nombre, vista, habilidad, ritmo, (p0, p1) = ANTIGUOS[perfil]
        sim = Simulador(sitio, objetivo, inicio, vista, rng, habilidad=habilidad, ritmo=ritmo,
                        paciencia=rng.randint(p0, p1), limite=config.MAX_STEPS + 5)
        modelo, motor = "claude-sonnet-4-5", "claude-code"
    else:
        p = PROFILES[perfil]
        nombre, vista = p.name, ("mobile" if p.screen.width < 600 else "desktop")
        conocimiento = p.conocimiento
        if p.explora:
            lugar = "menu" if perfil == "explorador" else perfil.split("_")[1]
            ajuste = {"conoce_tema": 0.1, "sin_contexto": -0.08}.get(conocimiento, 0)
            sim = Simulador(sitio, objetivo, inicio, vista, rng, habilidad=0.45 + ajuste, ritmo=1.3,
                            paciencia=p.limite_acciones, limite=p.limite_acciones, explora=True, primera_rama=lugar,
                            conocimiento=conocimiento)
            modelo = "us.anthropic.claude-sonnet-4-6"
        else:
            sim = Simulador(sitio, objetivo, inicio, vista, rng, habilidad=0.6 if vista == "desktop" else 0.5,
                            ritmo=1.0 if vista == "desktop" else 1.15, paciencia=rng.randint(9, 14),
                            limite=p.limite_acciones)
            modelo = "us.anthropic.claude-haiku-4-5"
        motor = "bedrock"
    if sim.explora:
        sim.explorar()
    else:
        sim.recorrer()

    final = sim.estado
    llego = final.pagina == sim.destino
    fin = sim.fin or "gave_up"
    error = fin in ERRORES
    migas = " > ".join([a.nombre for a in sitio.ancestros(final.pagina)[1:]] + [sitio.nombre(final)]) \
        if not final.pagina.startswith("404:") and final.pagina != "/buscar" else sitio.nombre(final)
    if error:
        mensaje = ERRORES[fin]
    elif fin == "done":
        mensaje = rng.choice([f"Está en {migas}.", f"Lo encontré en {migas}.", f"Para eso hay que ir a {migas}."])
    else:
        mensaje = rng.choice([f"No encontré dónde {objetivo.instruccion[0].lower()}{objetivo.instruccion[1:]}.",
                              f"Revisé {len(sim.vistas)} páginas y no lo encontré.",
                              "Me rindo: el sitio no muestra esa información donde la busqué."])
    reclamo = fin == "done"
    titulo_final = sitio.titulo(final)
    if error and estilo != "antiguo":
        veredicto = {"outcome": "interrupted", "source": None, "claimed_done": False,
                     "justification": f"El intento se interrumpió por un error técnico ({fin}): {mensaje}"}
    elif error:
        veredicto = {"outcome": "abandoned", "justification": f"El intento se interrumpió ({fin}): {mensaje}"}
    elif estilo == "ruta" and not con_ruta:
        veredicto = {"outcome": "unmeasured", "source": None, "claimed_done": reclamo,
                     "justification": "Sin ruta de referencia ni juez: el resultado no se mide."}
    elif estilo == "ruta":
        if llego:
            texto = "Llegó a la página final de la ruta de la Guía." + ("" if reclamo else
                                                                       " No declaró que había terminado.")
            veredicto = {"outcome": "success", "source": "route", "claimed_done": reclamo, "justification": texto}
        elif reclamo:
            veredicto = {"outcome": "failed", "source": "route", "claimed_done": True,
                         "justification": "Declaró que terminó, pero no llegó a la página final de la ruta de la Guía."}
        else:
            veredicto = {"outcome": "abandoned", "source": "route", "claimed_done": False,
                         "justification": "Se detuvo sin llegar a la página final de la ruta de la Guía."}
    else:
        criterio = criterio_de(sitio, objetivo)["criterion"]
        if llego and reclamo:
            veredicto = {"outcome": "success", "justification": f"La pantalla final ({titulo_final}) cumple: "
                                                                 f"{criterio.lower()}."}
        elif reclamo:
            veredicto = {"outcome": "failed", "justification": f"La pantalla final ({titulo_final}) no muestra lo "
                                                                f"pedido: {criterio.lower()}."}
        else:
            veredicto = {"outcome": "abandoned", "justification": f"Se detuvo en «{titulo_final}» sin encontrar lo "
                                                                   "pedido."}
        if estilo == "juez":
            veredicto = {"outcome": veredicto["outcome"], "source": "judge", "claimed_done": reclamo,
                         "justification": veredicto["justification"]}

    turnos = len(sim.pasos) + 1
    entrada = turnos * rng.randint(2400, 4200)
    salida = turnos * rng.randint(90, 220)
    precio = (1e-6, 5e-6) if "haiku" in modelo else (3e-6, 15e-6)
    ancho, alto = VISTAS[vista]
    instruccion = objetivo.coloquial if conocimiento == "sin_contexto" else objetivo.instruccion
    inicio_estado = sim.estados[0]
    run = {
        "profile": perfil,
        "profile_name": nombre,
        "viewport": f"{ancho}x{alto}",
        "model": modelo,
        "start_url": sitio.url(inicio_estado),
        "instruction": instruccion,
        "engine": motor,
    }
    if estilo != "antiguo":
        carpeta = perfil if repeticion == 1 else f"{perfil}-{repeticion}"
        run |= {"attempt": repeticion, "folder": carpeta, "started_at": comienzo.strftime("%Y-%m-%dT%H:%M:%SZ")}
    run |= {
        "start": {"url": sitio.url(inicio_estado), "title": sitio.titulo(inicio_estado), "screenshot": "step_00.png"},
        "steps": sim.pasos,
        "end_reason": fin,
        "final_message": mensaje,
        "duration_s": round(sim.t + rng.uniform(0.5, 2.0), 1),
        "turns": turnos,
        "screenshots_requested": rng.choice([0, 0, 0, 1, 2]),
        "incidents": [],
        "token_usage": {"input_tokens": entrada, "output_tokens": salida, "cache_read_input_tokens": 0,
                        "cache_creation_input_tokens": 0,
                        "equivalent_cost_usd": round(entrada * precio[0] + salida * precio[1], 4)},
        "final_screenshot": f"step_{len(sim.pasos):02d}.png",
        "verdict": veredicto,
    }
    if estilo != "antiguo":
        run |= {"videos": [], "video_offset_s": 0.0, "conocimiento": conocimiento,
                "tarea_coloquial": objetivo.coloquial if conocimiento == "sin_contexto" else None,
                "terminos_rechazados": [objetivo.termino] if conocimiento == "sin_contexto" else []}
    return run, sim.estados, vista


def criterio_de(sitio: Sitio, objetivo: Objetivo) -> dict:
    final = sitio.paginas[sitio.destinos[objetivo.id]]
    return {"criterion": f"Se ve la página «{final.nombre}» de {sitio.marca}",
            "evidence": [f"Un título que dice «{final.nombre}»", f"Las migas pasan por «{objetivo.pagina}»"]}


# ── Escritura en el almacén ──────────────────────────────────────────────────────────────────────────────────────


def iso(momento: datetime) -> str:
    return momento.strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_ms(momento: datetime) -> str:
    return momento.strftime("%Y-%m-%dT%H:%M:%S.") + f"{momento.microsecond // 1000:03d}Z"


def escribir_json(ruta: Path, valor) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(valor, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def manifiesto(agente, host, goal, viewport, run_id, inicio, fin, status, modelo, entradas=(), revision=None):
    datos = {"agent": agente, "host": host, "goal": goal, "viewport": viewport, "run_id": run_id,
             "started_at": iso(inicio), "status": status, "model": modelo, "inputs": list(entradas),
             "finished_at": iso(fin) if status != "running" else None, "schema_version": 1}
    if revision:
        datos["revision"] = revision
    return datos


class Almacen:
    def __init__(self, raiz: Path, capturas: Capturas):
        self.raiz, self.capturas = raiz / "corridas", capturas
        self.ids: set[str] = set()
        self.tandas = self.intentos = self.pasos = 0

    def run_id(self, prefijo: str, momento: datetime) -> tuple[str, datetime]:
        while f"{prefijo}/{momento.strftime('%Y-%m-%dT%H-%M-%SZ')}" in self.ids:
            momento += timedelta(seconds=1)
        run_id = momento.strftime("%Y-%m-%dT%H-%M-%SZ")
        self.ids.add(f"{prefijo}/{run_id}")
        return run_id, momento

    def tanda(self, sitio: Sitio, objetivo: Objetivo, comienzo: datetime, intentos: list[tuple[str, dict, list, str]],
              meta: dict, criterio: dict | None, entradas=(), revision=None) -> str:
        run_id, comienzo = self.run_id(f"{sitio.host}/visitor/{objetivo.id}", comienzo)
        base = self.raiz / sitio.host / "visitor" / objetivo.id / run_id
        runs = []
        for carpeta, run, estados, vista in intentos:
            (base / carpeta).mkdir(parents=True)
            escribir_json(base / carpeta / "run.json", run)
            for i, estado in enumerate(estados):
                enlazar(self.capturas.ruta(sitio, estado, vista), base / carpeta / f"step_{i:02d}.png")
            runs.append(run)
            self.intentos += 1
            self.pasos += len(run["steps"])
        arbol = build_route_tree([r for r in runs if r["verdict"].get("outcome") != "interrupted"])
        escribir_json(base / "route_tree.json", {**meta, "timestamp": comienzo.strftime("%Y-%m-%d_%H-%M-%S"),
                                                 "criteria": criterio, **arbol})
        if criterio:
            escribir_json(base / "criteria.json", criterio)
        duracion = max((r["duration_s"] for r in runs), default=30) + 20
        modelo = runs[0]["model"] if runs else None
        escribir_json(base / "manifest.json", manifiesto("visitor", sitio.host, objetivo.id, None, run_id, comienzo,
                                                        comienzo + timedelta(seconds=duracion), "succeeded", modelo,
                                                        entradas, revision))
        self.tandas += 1
        return f"{sitio.host}/visitor/{objetivo.id}/{run_id}"

    def corrida(self, agente: str, sitio: Sitio, goal: str | None, viewport: str | None, comienzo: datetime,
                fin: datetime, status: str, modelo: str, archivos: dict[str, str | dict], entradas=(),
                revision=None) -> str:
        partes = [sitio.host, agente, *([goal] if goal else []), *([viewport] if viewport else [])]
        prefijo = "/".join(partes)
        run_id, comienzo = self.run_id(prefijo, comienzo)
        base = self.raiz.joinpath(*partes, run_id)
        base.mkdir(parents=True)
        for nombre, contenido in archivos.items():
            if isinstance(contenido, str):
                (base / nombre).write_text(contenido, encoding="utf-8")
            else:
                escribir_json(base / nombre, contenido)
        escribir_json(base / "manifest.json", manifiesto(agente, sitio.host, goal, viewport, run_id, comienzo, fin,
                                                        status, modelo, entradas, revision))
        return f"{prefijo}/{run_id}"


def intentos_de(sitio, objetivo, inicio, perfiles: list[str], rng, estilo, comienzo, con_ruta=True):
    vistos: dict[str, int] = {}
    resultado = []
    for perfil in perfiles:
        vistos[perfil] = vistos.get(perfil, 0) + 1
        rep = vistos[perfil]
        run, estados, vista = intento(sitio, objetivo, inicio, perfil, rng, estilo=estilo, repeticion=rep,
                                      comienzo=comienzo, con_ruta=con_ruta)
        carpeta = perfil if rep == 1 else f"{perfil}-{rep}"
        resultado.append((carpeta, run, estados, vista))
    return resultado


def tanda_exploradores(almacen: Almacen, sitio: Sitio, rng: random.Random, comienzo: datetime) -> None:
    objetivo = rng.choice(list(sitio.objetivos.values()))
    conjunto = "conocimiento" if rng.random() < 0.4 else "base"
    perfiles = list(CONJUNTOS_EXPLORADORES[conjunto])
    intentos = intentos_de(sitio, objetivo, "/", perfiles, rng, "juez", comienzo)
    meta = {"url": f"https://www.{sitio.host}/", "instruction": objetivo.instruccion, "task_id": objetivo.id,
            "engine": "bedrock", "browser": "agentcore", "user_model": "us.anthropic.claude-sonnet-4-6",
            "judge_model": "us.anthropic.claude-sonnet-4-6", "effort": None, "runs": 1, "tema": None,
            "conjunto_exploradores": conjunto}
    if conjunto == "conocimiento":
        meta["tarea_sin_contexto"] = objetivo.coloquial
    almacen.tanda(sitio, objetivo, comienzo, intentos, meta, criterio_de(sitio, objetivo))


def tanda_antigua(almacen: Almacen, sitio: Sitio, rng: random.Random, comienzo: datetime) -> None:
    objetivo = rng.choice(list(sitio.objetivos.values()))
    perfiles = [p for p in ANTIGUOS if rng.random() < 0.85] or ["first_time"]
    intentos = intentos_de(sitio, objetivo, "/", perfiles, rng, "antiguo", comienzo)
    meta = {"url": f"https://www.{sitio.host}/", "instruction": objetivo.instruccion, "task_id": objetivo.id,
            "engine": "claude-code", "user_model": "claude-sonnet-4-5", "judge_model": "claude-sonnet-4-5",
            "effort": "low"}
    almacen.tanda(sitio, objetivo, comienzo, intentos, meta, criterio_de(sitio, objetivo))


# ── Revisiones (tabla chameleon-revisiones) ──────────────────────────────────────────────────────────────────────


def base36(n: int) -> str:
    digitos = "0123456789abcdefghijklmnopqrstuvwxyz"
    texto = ""
    while n:
        n, r = divmod(n, 36)
        texto = digitos[r] + texto
    return texto or "0"


def tema_css(sitio: Sitio, revision: str) -> str:
    acento = "#{:02x}{:02x}{:02x}".format(*oscurecer(sitio.color, 0.1))
    return (f"/* Tema de Chameleon para {sitio.host} (revisión {revision}). Datos de prueba. */\n"
            f"html.mi-tema {{ --mi-acento: {acento}; --mi-fondo: #fbfaf7; --mi-texto: #1f2933; }}\n"
            "html.mi-tema body { background: var(--mi-fondo) !important; color: var(--mi-texto) !important;\n"
            "  font-size: 112% !important; line-height: 1.6 !important; }\n"
            "html.mi-tema a { color: var(--mi-acento) !important; text-decoration: underline !important; }\n"
            "html.mi-tema button, html.mi-tema [role=\"button\"] { min-height: 44px !important; }\n")


def ruta_de_guia(sitio: Sitio, objetivo: Objetivo, inicio: str) -> dict:
    destino = sitio.destinos[objetivo.id]
    dist = sitio.distancias(destino)
    camino, actual = [Estado(inicio)], inicio
    pasos = []
    while actual != destino and len(pasos) < 10:
        e = min((e for e in sitio.enlaces(Estado(actual)) if e.destino in dist), key=lambda e: dist[e.destino])
        camino.append(Estado(e.destino))
        pasos.append({"source": f"n{len(pasos) + 1}", "target": f"n{len(pasos) + 2}", "action": f"clic «{e.etiqueta}»",
                      "url": sitio.url(Estado(e.destino)), "title": sitio.titulo(Estado(e.destino))})
        actual = e.destino
    final = Estado(destino)
    return {"url": sitio.url(Estado(inicio)), "goal": objetivo.id, "viewport": "desktop",
            "instruction": objetivo.instruccion, "verified": True,
            "start": {"node": "n1", "url": sitio.url(Estado(inicio)), "title": sitio.titulo(Estado(inicio))},
            "final_node": f"n{len(pasos) + 1}", "steps": pasos,
            "final": {"url": sitio.url(final), "title": sitio.titulo(final), "quote": sitio.nombre(final)}}


def goals_json(sitio: Sitio, url: str, elegibles: list[Objetivo]) -> dict:
    goals = []
    for o in elegibles:
        destino = sitio.url(Estado(sitio.destinos[o.id]))
        goals.append({"id": o.id, "host": sitio.host, "start_url": url, "description": o.instruccion,
                      "expected_answer": None, "level": "user_goal", "parent": None,
                      "intent": "reach_page", "evidence": [destino], "entry": f"/{slug(o.seccion)}",
                      "submits_form": False, "prominence": o.prominencia, "gates": [], "instruction": o.instruccion,
                      "exclusion": None})
    for id_, texto, barreras, exclusion in CON_BARRERA:
        goals.append({"id": id_, "host": sitio.host, "start_url": url, "description": texto, "expected_answer": None,
                      "level": "user_goal", "parent": None, "intent": "transact", "evidence": [],
                      "entry": "/ingresar", "submits_form": True, "prominence": "primary", "gates": barreras,
                      "instruction": texto, "exclusion": exclusion})
    return {"host": sitio.host, "url": url, "goals": goals}


def elegidos(objetivos: list[Objetivo], maximo: int) -> list[Objetivo]:
    """La misma selección que la proyectora y el conductor: los más escondidos primero y luego por id."""
    orden = ["buried", "secondary", "primary"]
    return sorted(objetivos, key=lambda o: (orden.index(o.prominencia), o.id))[:maximo]


def revision(almacen: Almacen, sitio: Sitio, rng: random.Random, creada: datetime, ahora: datetime, *,
             atascada: bool = False, goals_max: int = 3) -> list[dict]:
    """Los ítems de una revisión según lo que ya pasó a la hora `ahora`, y las corridas que dejó en el almacén."""
    rev = f"{base36(int(creada.timestamp() * 1000))}-{rng.getrandbits(24):06x}"
    inicio = "/" if rng.random() < 0.7 else rng.choice(sitio.menu).destino
    url = sitio.url(Estado(inicio))
    pk = f"REV#{rev}"
    meta = {"PK": pk, "SK": "META", "url": url, "host": sitio.host, "status": "queued", "created_at": iso_ms(creada),
            "updated_at": iso_ms(creada)}
    items = [meta]
    fallo = rng.choices(["ninguno", "invocacion", "catalogo", "mejorador"], [84, 4, 5, 7])[0]
    ultimo = creada

    def ocurrio(momento: datetime) -> bool:
        return momento <= ahora

    def tocar(momento: datetime) -> None:
        nonlocal ultimo
        ultimo = max(ultimo, min(momento, ahora))

    if fallo == "invocacion" and not atascada:
        meta |= {"status": "failed", "error": "AgentCore429: ThrottlingException: Rate exceeded",
                 "updated_at": iso_ms(creada + timedelta(seconds=1))}
        return items
    t = creada + timedelta(seconds=rng.uniform(2, 6))
    if not ocurrio(t):
        return items
    meta["status"] = "running"
    tocar(t)

    def etapa(sk: str, comienzo: datetime, fin: datetime, status: str, run_key: str | None) -> dict:
        item = {"PK": pk, "SK": sk, "status": status, "updated_at": iso_ms(min(fin if status != "running" else
                                                                                comienzo, ahora))}
        if run_key:
            item["run_key"] = run_key
        items.append(item)
        tocar(fin if status != "running" else comienzo)
        return item

    # Cataloger
    c0 = t + timedelta(seconds=2)
    c1 = c0 + timedelta(seconds=rng.uniform(50, 160))
    if not ocurrio(c0):
        return items
    termina = ocurrio(c1) and not atascada
    status = ("failed" if fallo == "catalogo" else "succeeded") if termina else "running"
    catalogo = rng.sample(list(sitio.objetivos.values()), rng.randint(3, len(sitio.objetivos)))
    archivos = {"goals.json": goals_json(sitio, url, catalogo)} if status == "succeeded" else {}
    clave_cat = almacen.corrida("cataloger", sitio, None, None, c0, c1, status, "us.anthropic.claude-sonnet-4-6",
                                archivos, revision=rev)
    etapa("STAGE#cataloger", c0, c1, status, clave_cat)
    if status == "running":
        meta["updated_at"] = iso_ms(ultimo)
        return items
    if status == "failed":
        meta |= {"status": "failed", "updated_at": iso_ms(c1)}
        return items

    goals = elegidos(catalogo, goals_max)
    meta["goals_total"] = len(goals)
    t = c1
    pendientes = {o.id: {"guide": None, "visitor": None} for o in goals}
    claves_visitor = []
    for o in goals:
        g0 = t + timedelta(seconds=rng.uniform(1, 4))
        g1 = g0 + timedelta(seconds=rng.uniform(60, 200))
        if not ocurrio(g0):
            break
        g_termina = ocurrio(g1)
        g_status = ("failed" if rng.random() < 0.07 else "succeeded") if g_termina else "running"
        archivos = {"route.json": ruta_de_guia(sitio, o, inicio)} if g_status == "succeeded" else {}
        clave_guia = almacen.corrida("guide", sitio, o.id, "desktop", g0, g1, g_status,
                                     "us.anthropic.claude-sonnet-4-6", archivos, [clave_cat], rev)
        pendientes[o.id]["guide"] = (g_status, clave_guia, g0, g1)
        if g_status == "running":
            t = g1
            break
        v0 = g1 + timedelta(seconds=rng.uniform(1, 4))
        perfiles = ["desktop"] * rng.choice([1, 2, 2, 3]) + ["mobile"] * rng.choice([0, 1, 1, 2])
        if not ocurrio(v0):
            t = g1
            break
        # El visitante tarda lo que tarda su intento más largo; se simula antes para saber cuándo termina.
        intentos = intentos_de(sitio, o, inicio, perfiles, rng, "ruta", v0, con_ruta=g_status == "succeeded")
        v1 = v0 + timedelta(seconds=max(r["duration_s"] for _, r, _, _ in intentos) + rng.uniform(15, 40))
        if not ocurrio(v1) or atascada:
            clave = almacen.corrida("visitor", sitio, o.id, None, v0, v1, "running", "us.anthropic.claude-haiku-4-5",
                                    {}, [clave_guia], rev)
            pendientes[o.id]["visitor"] = ("running", clave, v0, v1)
            t = v1
            break
        if rng.random() < 0.05:
            clave = almacen.corrida("visitor", sitio, o.id, None, v0, v1, "failed", "us.anthropic.claude-haiku-4-5",
                                    {}, [clave_guia], rev)
            pendientes[o.id]["visitor"] = ("failed", clave, v0, v1)
        else:
            meta_tanda = {"url": url, "instruction": o.instruccion, "task_id": o.id, "engine": "bedrock",
                          "browser": "agentcore", "user_model": "us.anthropic.claude-haiku-4-5", "judge_model": None,
                          "effort": None, "runs": len(perfiles), "tema": None, "conjunto_exploradores": None}
            clave = almacen.tanda(sitio, o, v0, intentos, meta_tanda, None, [clave_guia], rev)
            pendientes[o.id]["visitor"] = ("succeeded", clave, v0, v1)
            claves_visitor.append(clave)
        t = v1

    for o in goals:
        for agente in ("guide", "visitor"):
            estado = pendientes[o.id][agente]
            if estado is None:
                items.append({"PK": pk, "SK": f"GOAL#{o.id}#{agente}", "status": "pending", "updated_at": iso_ms(c1)})
            else:
                status, clave, comienzo, fin = estado
                etapa(f"GOAL#{o.id}#{agente}", comienzo, fin, status, clave)

    todos = all(pendientes[o.id]["visitor"] and pendientes[o.id]["visitor"][0] != "running" for o in goals)
    if todos and not atascada:
        i0 = t + timedelta(seconds=rng.uniform(2, 6))
        i1 = i0 + timedelta(seconds=rng.uniform(40, 110))
        if ocurrio(i0):
            i_termina = ocurrio(i1)
            i_status = ("failed" if fallo == "mejorador" else "succeeded") if i_termina else "running"
            archivos = {"tema.css": tema_css(sitio, rev)} if i_status == "succeeded" else {}
            clave_imp = almacen.corrida("improver", sitio, None, None, i0, i1, i_status,
                                        "us.anthropic.claude-sonnet-4-6", archivos, [clave_cat, *claves_visitor], rev)
            etapa("STAGE#improver", i0, i1, i_status, clave_imp)
            if i_status == "succeeded":
                meta["css_key"] = f"{clave_imp}/tema.css"
            fin = i1 + timedelta(seconds=rng.uniform(1, 3))
            if i_termina and ocurrio(fin):
                meta["status"] = "failed" if i_status == "failed" else "done"
                tocar(fin)
    meta["updated_at"] = iso_ms(ultimo)
    return items


# ── Principal ────────────────────────────────────────────────────────────────────────────────────────────────────


def preparar_salida(salida: Path) -> None:
    if salida.exists():
        if not (salida / MARCA_DE_GENERADO).exists():
            sys.exit(f"✘ {salida} existe y no la creó este script: no la borro. Elige otra con --salida.")
        shutil.rmtree(salida)
    salida.mkdir(parents=True)
    (salida / MARCA_DE_GENERADO).write_text("Carpeta generada por backoffice/mock/generar.py: se borra al regenerar.\n")


def tamano(carpeta: Path) -> int:
    vistos, total = set(), 0
    for ruta in carpeta.rglob("*"):
        if ruta.is_file():
            info = ruta.stat()
            if info.st_ino not in vistos:
                vistos.add(info.st_ino)
                total += info.st_size
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--salida", type=Path, default=SALIDA_POR_DEFECTO, help="carpeta de salida (backoffice/.mock)")
    parser.add_argument("--escala", type=float, default=1.0,
                        help="multiplica cuántas revisiones y tandas se generan (1: ~90 revisiones, ~280 tandas)")
    parser.add_argument("--semilla", type=int, default=7, help="misma semilla, mismos datos (salvo las fechas)")
    parser.add_argument("--dias", type=int, default=30, help="cuántos días hacia atrás se reparten las corridas")
    parser.add_argument("--sin-capturas", action="store_true", help="capturas de 1x1 en vez de wireframes (más rápido)")
    args = parser.parse_args()

    comienzo_reloj = time.monotonic()
    rng = random.Random(args.semilla)
    ahora = datetime.now(UTC).replace(microsecond=0)
    salida = args.salida.resolve()
    preparar_salida(salida)
    capturas = Capturas(salida / "capturas", dibujar=not args.sin_capturas)
    almacen = Almacen(salida, capturas)
    sitios = [Sitio(host, marca, rubro, color, random.Random(f"{args.semilla}{host}"))
              for host, marca, rubro, color in SITIOS]
    # Algunos sitios se revisan mucho más que otros.
    pesos = [rng.uniform(0.3, 3.0) for _ in sitios]

    n_revisiones = max(1, round(90 * args.escala))
    items = []
    for i in range(n_revisiones):
        sitio = rng.choices(sitios, pesos)[0]
        if i < 2:
            creada = ahora - timedelta(seconds=rng.uniform(0, 1.5))  # recién pedidas: en cola
        elif i < 6:
            creada = ahora - timedelta(minutes=rng.uniform(1, 12))  # en curso
        else:
            creada = ahora - timedelta(hours=min(args.dias * 24, rng.expovariate(1 / 90)))
        atascada = i == 6  # el runtime murió: sigue running sin novedades hace horas
        if atascada:
            creada = ahora - timedelta(hours=3)
        items += revision(almacen, sitio, rng, creada, ahora, atascada=atascada)
        print(f"\r  revisiones {i + 1}/{n_revisiones} · tandas {almacen.tandas}", end="", flush=True)
    urls: dict[str, dict] = {}
    for item in items:
        if item["SK"] == "META" and (item["url"] not in urls or item["created_at"] > urls[item["url"]]["created_at"]):
            urls[item["url"]] = {"PK": f"URL#{item['url']}", "SK": "URL", "revision": item["PK"][4:],
                                 "created_at": item["created_at"]}
    escribir_json(salida / "revisiones.json", {"tabla": TABLA, "generado": iso_ms(ahora),
                                               "items": items + list(urls.values())})
    print()

    n_exploradores = round(45 * args.escala)
    for i in range(n_exploradores):
        sitio = rng.choices(sitios, pesos)[0]
        tanda_exploradores(almacen, sitio, rng, ahora - timedelta(hours=rng.uniform(1, args.dias * 24)))
        print(f"\r  tandas de exploradores {i + 1}/{n_exploradores}", end="", flush=True)
    print()
    n_antiguas = round(25 * args.escala)
    for i in range(n_antiguas):
        sitio = rng.choices(sitios, pesos)[0]
        tanda_antigua(almacen, sitio, rng, ahora - timedelta(days=rng.uniform(args.dias, args.dias * 2)))
        print(f"\r  tandas antiguas {i + 1}/{n_antiguas}", end="", flush=True)
    print()

    metas = [i for i in items if i["SK"] == "META"]
    por_estado = {}
    for meta in metas:
        por_estado[meta["status"]] = por_estado.get(meta["status"], 0) + 1
    print(f"✔ {salida} en {time.monotonic() - comienzo_reloj:.0f} s · {tamano(salida) / 1e6:.0f} MB")
    print(f"  {almacen.tandas} tandas · {almacen.intentos} intentos · {almacen.pasos} pasos · "
          f"{len(capturas.rutas)} capturas distintas · {len(sitios)} sitios")
    print(f"  {len(metas)} revisiones: " + ", ".join(f"{n} {estado}" for estado, n in sorted(por_estado.items())))


if __name__ == "__main__":
    main()
