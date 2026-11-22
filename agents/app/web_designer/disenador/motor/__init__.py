"""Motor de direcciones de arte: el modelo elige dirección, semilla y ajustes; el código compone y verifica."""

from disenador.motor.componer import ErrorDeComposicion, Tema, componer, regla_de_ocultar
from disenador.motor.sitio import Sitio, rasgos_del_sitio

__all__ = ["ErrorDeComposicion", "Sitio", "Tema", "componer", "rasgos_del_sitio", "regla_de_ocultar"]
