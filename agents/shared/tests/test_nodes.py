from shared.nodes.urls import node_key, normalize_url, same_site


def test_normalize_url_drops_tracking_fragment_and_www():
    url = "https://www.Example.com/sucursales/?utm_source=x&b=2&a=1&gclid=z#mapa"
    assert normalize_url(url) == "https://example.com/sucursales?a=1&b=2"


def test_normalize_url_keeps_spa_routes():
    assert normalize_url("https://app.cl/#/perfil") == "https://app.cl/#/perfil"


def test_node_key_joins_the_normalized_url_and_the_title():
    assert node_key("https://www.s.cl/a/", " Título ") == "https://s.cl/a | Título"


def test_same_site_accepts_subdomains_of_the_start_host_only():
    start = "https://www.sii.cl/"
    assert same_site("https://homer.sii.cl/", start) and same_site("https://sii.cl/servicios_online", start)
    assert not same_site("https://sii.cl.evil.com/", start) and not same_site("https://gob.cl/", "https://www.dt.gob.cl/")
