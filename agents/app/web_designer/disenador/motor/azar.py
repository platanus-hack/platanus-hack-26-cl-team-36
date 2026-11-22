"""Aleatoriedad reproducible: la misma semilla da siempre el mismo tema.

Es el mismo generador que el prototipo en Node (mulberry32 con la semilla mezclada por la razón áurea), en aritmética
de 32 bits: con la misma semilla las dos implementaciones sacan la misma secuencia.
"""

_M = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & _M


class Azar:
    def __init__(self, semilla: int):
        # Semillas cercanas (1, 2, 3...) quedan lejos tras mezclarlas.
        self._s = _imul((int(semilla) & _M) or 1, 0x9E3779B1)

    def num(self) -> float:
        self._s = (self._s + 0x6D2B79F5) & _M
        t = self._s
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & _M
        return (t ^ (t >> 14)) / 4294967296

    def rango(self, r):
        """Un valor dentro de `[min, max]`; un número suelto es un valor fijo (y no consume la secuencia)."""
        if not isinstance(r, list):
            return r
        return r[0] + (r[1] - r[0]) * self.num()

    def si(self, p: float) -> bool:
        return self.num() < p

    def elegir(self, lista: list):
        return lista[int(self.num() * len(lista))]

    def ponderado(self, pesos: dict[str, float]) -> str:
        entradas = [(k, p) for k, p in pesos.items() if p > 0]
        total = 0.0
        for _, p in entradas:  # sin `sum()`, que en 3.12 compensa el redondeo y se aparta del prototipo
            total += p
        x = self.num() * total
        for k, p in entradas:
            x -= p
            if x <= 0:
                return k
        return entradas[-1][0]
