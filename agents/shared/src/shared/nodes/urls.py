"""URL normalizada, nodo de una página y sitio de una URL."""

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING_PARAMS = re.compile(r"^(utm_.*|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid)$", re.I)
_DEFAULT_PORTS = {"http": 80, "https": 443}


def normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if parts.port and parts.port != _DEFAULT_PORTS.get(scheme):
        host = f"{host}:{parts.port}"
    path = re.sub(r"/+$", "", parts.path) or "/"
    query = urlencode(sorted(
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not _TRACKING_PARAMS.match(key)
    ))
    # Se descarta el fragmento, salvo rutas de SPA (#/ruta o #!/ruta).
    fragment = parts.fragment if parts.fragment.startswith(("/", "!/")) else ""
    return urlunsplit((scheme, host, path, query, fragment))


def node_key(url: str, title: str) -> str:
    return f"{normalize_url(url)} | {(title or '').strip()}"


def site_host(url: str) -> str:
    """El host normalizado como en los nodos (sin www, con el puerto si no es el de siempre); vacío sin host."""
    return urlsplit(normalize_url(url)).netloc


def same_site(url: str, start_url: str) -> bool:
    """El host es el de la página inicial o un subdominio suyo."""
    host, site = site_host(url), site_host(start_url)
    return host == site or host.endswith(f".{site}")
