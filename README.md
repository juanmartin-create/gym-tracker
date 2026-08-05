# THRST — Training Log

App personal para trackear entrenamiento y macros. Inspirada en la THRST App de Mike Thurston.

- **Local-first**: todo en `localStorage`, sin cuentas.
- **Offline PWA**: se instala en iOS/Android desde el navegador.
- **Sin build**: HTML + CSS + JS puro. Cualquier hosting estatico la sirve.

## Features

**Train**
- Prescripcion por serie (reps @ RIR objetivo).
- Sugerencia automatica de peso segun ultima sesion + RIR.
- Warm-up ramp automatica cuando el peso >= 40 kg.
- Timer de descanso auto-lanzado al marcar la serie hecha.
- Marca de PR (◆) cuando superas tu mejor e1RM.
- Notas por sesion.

**Program**
- Rutinas con ejercicios etiquetados por musculo.
- Prescripcion editable (reps + RIR por set).
- Split Nippard 5 dias precargado (Lun pierna, Mar pull, Mie push, Jue pierna posterior, Vie upper, Sab opcional).

**Dashboard**
- Racha semanal (semanas consecutivas con 3+ sesiones).
- Consistencia · ultimas 8 semanas en barras.
- Top 3 progresiones (delta e1RM).
- Volumen semanal por musculo con zonas MEV / MAV.
- Peso corporal con sparkline.

**Food** (macros al estilo THRST)
- Setup con Mifflin-St Jeor: kcal + P/C/F automaticos.
- Biblioteca de alimentos base (pollo, arroz, whey, huevo, etc.).
- Log diario agrupado por Desayuno / Almuerzo / Merienda / Cena / Pre-Post.
- Progress bars por macro y kcal.

**Log**
- Historial cronologico con top set y PRs marcados.
- **Exportar CSV**: una fila por serie hecha (fecha, rutina, ejercicio, musculo, peso, reps, RIR, e1RM). Para abrir en Excel / Sheets y analizar la progresion.
- **Backup completo (JSON)**: dump de todo el estado — rutinas, sesiones, peso corporal, comidas, alimentos, perfil y objetivos.
- **Restaurar backup**: levanta un JSON en un celular nuevo. Hace *merge por union*, no reemplaza: las sesiones que ya estan en el dispositivo no se borran, y si un id coincide gana la version con mas series marcadas. Las rutinas, perfil y objetivos si pasan a ser los del backup.
- Aviso de "ultimo backup" con recordatorio a los 14 dias. Exportar CSV no cuenta como backup (es un formato con perdida).

## Deploy en Netlify (auto-actualiza en iOS al re-abrir)

1. Fork o push del repo.
2. En Netlify: New site from Git → repo `gym-tracker` → Deploy.
3. Configuracion incluida en `netlify.toml`: HTML / SW / manifest con `max-age=0` para que las actualizaciones lleguen rapido a la PWA instalada.
4. Abrí la URL en Safari → Compartir → Agregar a inicio.
5. Cada `git push` a `main` re-despliega automatico. En la proxima apertura de la PWA, el service worker instala la nueva version.

## Estructura

```
gym-tracker/
├── index.html
├── styles.css
├── app.js
├── sw.js                # cache-first + skipWaiting/clients.claim
├── manifest.webmanifest
├── netlify.toml         # cache headers agresivos en HTML/SW
└── icons/
```

## Datos

Todo en `localStorage` bajo `gymtracker:v3`. Migracion automatica desde v1/v2.

**Un deploy no borra tus datos.** La app solo hace `getItem` / `setItem` sobre esa clave: no existe ningun `localStorage.clear()` ni `removeItem` en el codigo. Cuando sube la version del service worker se borra el cache de *assets* (HTML/CSS/JS), que es un almacenamiento distinto de `localStorage` — el log sobrevive intacto.

Lo que si te puede hacer perder el progreso, y es la razon del backup:

- Borrar el historial / cache del sitio en Safari.
- Perder o resetear el celular.
- ITP de Safari: descarta el storage de sitios web no visitados en ~7 dias (instalar la PWA en la pantalla de inicio y usarla lo evita).

Bajate el JSON cada tanto y guardalo en iCloud/Drive.
