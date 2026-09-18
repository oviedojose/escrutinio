# Escrutinio TSJE

Aplicación web para consultar y visualizar resultados de Intendente y Junta
Municipal a partir de los datos de divulgación de resultados del TSJE
(Tribunal Superior de Justicia Electoral, Paraguay), incluyendo el armado de
bancas según el sistema electoral paraguayo (orden por voto preferencial +
reparto entre listas por método D'Hondt).

> **Proyecto personal no oficial**, con fines educativos y de portfolio, que
> consume el mismo endpoint público que usa
> [`resultados.tsje.gov.py`](https://resultados.tsje.gov.py/publicacion/divulgacion.html).
> No reemplaza ni representa una fuente oficial de resultados.

## Estado del proyecto

En construcción. Ver el plan de desarrollo completo (historias de usuario,
stack y decisiones de arquitectura) en [`docs/plan-desarrollo.md`](docs/plan-desarrollo.md).

## Desarrollo local

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

Variables de entorno necesarias: ver [`.env.example`](.env.example).
