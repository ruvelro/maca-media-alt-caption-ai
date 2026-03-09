# maca for Firefox

README específico de la versión para `Firefox`.

La información general del proyecto, funciones, arquitectura y flujo de uso está en:

- `../README.md`

## Estado

- Navegador: `Firefox`
- Versión: `1.0.7`
- Carpeta de la extensión: `maca for firefox/`
- Tipo: `Manifest V3` adaptado a Firefox

## Instalación en Firefox

### Opción recomendada para pruebas

1. Abre `about:debugging#/runtime/this-firefox`
2. Pulsa `Cargar complemento temporal`
3. Selecciona `manifest.json` dentro de `maca for firefox`

### Instalación desde paquete

Archivos preparados:

- `../maca-for-firefox-1.0.7-unsigned.zip`
- `../maca-for-firefox-1.0.7-unsigned.xpi`

Uso recomendado:

1. Para pruebas, abre `about:debugging#/runtime/this-firefox`
2. Pulsa `Cargar complemento temporal`
3. Selecciona:
   - `manifest.json` de la carpeta, o
   - el `.xpi` si tu entorno Firefox acepta carga temporal desde paquete

## Notas específicas de Firefox

- Firefox sí utiliza `XPI`
- El paquete actual es `unsigned`
- Para instalación permanente habitual en Firefox estable, suele hacer falta firma de Mozilla
- Si Firefox muestra `complemento dañado`, normalmente no es un problema del ZIP/XPI sino de firma o compatibilidad del manifiesto

## Archivos principales

- `manifest.json`
- `background.js`
- `context_helper.js`
- `overlay.js`
- `options.*`
- `popup.*`

## Compatibilidad

- Diseñada para `WordPress`
- Limitada a `wp-admin`

## Diagnóstico rápido

Si algo falla:

1. Carga la extensión temporalmente desde `about:debugging`
2. Revisa `Opciones`
3. Ejecuta `Probar configuración`
4. Si hace falta, activa debug
