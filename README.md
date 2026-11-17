# 🌱 Brotes

Juego de cartas de faroles para 2 a 10 jugadores. Cada jugador cuida un jardín secreto de 2 plantas, junta gotas de agua y puede mentir sobre qué plantas tiene. El último jardín en pie gana.

## Estado actual

**🌐 Modo online** (cada uno en su móvil):
1. Uno pulsa **Crear sala** y comparte el código (o el enlace de **Invitar amigos**).
2. Los demás escriben el código y pulsan **Unirme**. Hasta 10 jugadores.
3. Quien creó la sala pulsa **Empezar partida**.

Cada jugador ve solo sus cartas: la partida la guarda el servidor, no los móviles. Para desafiar o bloquear hay 15 segundos; si nadie responde, el juego sigue solo. Si se recarga la página, vuelves a tu partida.

**📱 Modo prueba**: se juega pasando el móvil, con una pantalla "Pásale el móvil a…" entre turnos.

- Mesa con los jugadores alrededor, el mazo al centro, tus cartas abajo, tu contador de gotas y 4 botones: 💧 refrescarse, 💧💧 ayuda, 🎯 exterminar y ⭐ habilidad (las que no tienes se usan con **astucia**).
- Botón **📖 Guía** con las cartas para pasar deslizando, y reglas rápidas.

Pendiente: APK de Android.

## Servidor online (Supabase)

- `supabase/schema.sql`: tabla `rooms`. Solo el servidor puede leerla (RLS sin políticas).
- `supabase/functions/brotes/index.ts`: servidor del juego (Edge Function). Usa el mismo motor `js/engine.js`.
- `supabase/deploy.sh`: sube el servidor. Necesita `SUPABASE_ACCESS_TOKEN`.
- `js/config.js`: dirección del proyecto y clave pública (publishable).

## Cómo probarlo

Abre `index.html` en el navegador. No hace falta instalar nada.

Prueba del servidor real (necesita red):

```bash
node test/server.test.js
```

## Pruebas del motor

```bash
node test/engine.test.js
```

Incluye escenarios de cada regla y 3.000 partidas aleatorias de 2 a 10 jugadores.

## Reglas

- **Inicio:** 2 cartas boca abajo y 2 gotas por jugador. Mazo de 25 cartas (5 de cada planta).
- **Acciones del turno** (una sola):
  1. **Refrescarse:** +1 gota.
  2. **Pedir ayuda a la naturaleza:** +2 gotas. La bloquea la Planta Carnívora.
  3. **Exterminar:** paga 8 gotas y un jugador pierde una planta. No se bloquea ni se desafía. Con 11 gotas o más es obligatorio.
  4. **Usar la habilidad de una planta**, la tengas o no.
- **Plantas:**
  - 🌳 **Tronco Robusto:** roba 2 gotas a otro jugador. Bloquea a otro Tronco y a la Enredadera. Quien está enganchado puede usarlo para soltarse.
  - 🌻 **Girasol:** cambia sus cartas con 2 del mazo. Bloquea al Tronco.
  - 🌿 **Enredadera:** se engancha a un jugador y gana 1 gota cada vez que él recibe agua. Se queda hasta que la víctima se suelte con un Tronco o su dueño pierda una carta. Bloquea al Cactus.
  - 🌵 **Cactus:** paga 3 gotas y un jugador pierde una planta.
  - 🪴 **Planta Carnívora:** toma 3 gotas del manantial. Bloquea la ayuda de la naturaleza.
- **Desafíos:** si el desafiado mentía, pierde una planta y su acción falla (se le devuelve lo pagado). Si decía la verdad, el desafiante pierde una planta y el desafiado cambia esa carta por otra del mazo.
- **Abono:** al perder las 2 plantas te conviertes en Abono. Ganas 1 gota en cada turno y con 6 vuelves con 1 planta y 2 gotas. Solo una vez por partida, y no si quedan solo 2 jugadores vivos.

## Estructura

- `js/engine.js`: reglas del juego (sin pantalla ni red).
- `js/app.js`: interfaz del modo prueba.
- `css/style.css`: estilos.
- `assets/`: cartas, guía y logo.
- `test/engine.test.js`: pruebas.
