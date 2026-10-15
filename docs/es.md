# Honeywell Home (Lyric)

Esta integración lleva a Gladys sus termostatos wifi **Honeywell Home / Resideo**: Lyric Round,
T5, T6, T9 y T10, así como los sensores de habitación de los T9/T10. Utiliza la API oficial en
la nube de Resideo, con una aplicación de desarrollador gratuita que usted mismo crea, como la
integración `lyric` de Home Assistant. Obtiene la temperatura, la humedad, las consignas, el
modo, lo que hace el equipo y la programación de cada termostato, y los controla desde el panel
y desde las escenas.

No sirve para los antiguos termostatos Honeywell **Total Connect Comfort** (otra API) ni para
los sistemas evohome.

Esta integración no está afiliada a Resideo ni a Honeywell. Desarrollada sin el hardware: sus
comentarios son bienvenidos en [GitHub](https://github.com/guim31/gladys-honeywell-lyric/issues).

## Lo que necesita

- Gladys 5.1 o posterior, con acceso a Internet.
- Un termostato que ya funcione en la aplicación **Resideo** (Honeywell Home).
- Una cuenta gratuita en el [sitio para desarrolladores de Resideo](https://developer.honeywellhome.com/),
  para crear su propia aplicación: Resideo no ofrece una clave común al software de terceros.

## Puesta en marcha

### 1. Cree su aplicación de desarrollador de Resideo

1. En [developer.honeywellhome.com](https://developer.honeywellhome.com/), regístrese
   (cualquier dirección de correo) e inicie sesión.
2. Abra **My Apps** y luego **Create New App**.
3. **App Name**: lo que quiera, por ejemplo `Gladys`.
4. **Callback URL**: `https://my.gladysassistant.com/redirect/oauth` (la página HTTPS con la que
   Gladys le devuelve a su propio Gladys tras iniciar sesión).
5. Guarde. Abra su aplicación en **My Apps**: muestra una **Consumer Key** y un **Consumer
   Secret**. Una aplicación nueva puede quedar «pendiente» un tiempo antes de que Resideo la
   acepte.

### 2. Introduzca la clave y el secreto

En Gladys, abra **Integraciones → Honeywell Home (Lyric) → Configuración**, pegue la
**Consumer key (clave)** y el **Consumer secret (secreto)**, elija el **idioma de los nombres de
funciones** y haga clic en **Guardar**.

### 3. Conecte su cuenta

Haga clic en **Conectar** junto a **Cuenta Honeywell Home**. Resideo abre su página de inicio de
sesión: inicie sesión con la cuenta de la aplicación Resideo, marque los termostatos que Gladys
puede usar y acepte. Vuelve a Gladys y, unos segundos después, el estado indica que la
integración está conectada. Los termostatos aparecen entonces en la pestaña **Descubrir**:
añádalos.

Bajo **Conectar**, la pantalla de configuración muestra la **URI de redirección para declarar
en su aplicación de desarrollador**: `https://my.gladysassistant.com/redirect/oauth`. Si accede
a Gladys mediante HTTPS y marca **Usar en su lugar la dirección de mi instancia**, muestra en
su lugar la dirección de su instancia: indique entonces esa como Callback URL de su aplicación
Resideo.

### Si Conectar no vuelve a Gladys

Utilice el código pegado:

1. En su aplicación Resideo, ponga la **Callback URL** en `https://localhost/`.
2. En Gladys, indique la misma dirección en **URL de retorno (código pegado)**, guarde y haga
   clic en **Conectar**.
3. Tras iniciar sesión, el navegador muestra una página de error en `localhost`: es normal.
   Copie la dirección completa de la barra de direcciones (contiene `?code=…`).
4. En los minutos siguientes (un código solo vale una vez y poco tiempo), péguela en la acción
   **Pegar el código de autorización** de la pantalla de configuración y ejecútela. La respuesta
   es, por ejemplo, «Conectado a Resideo: 2 termostato(s).».

Los tokens se guardan en `/data`: solo vuelve a conectarse si Resideo los rechaza.

## El dispositivo de cada termostato

Un dispositivo por termostato, con el nombre que tiene en la aplicación Resideo. Sus funciones
dependen del modelo:

| Función                                                                      | Qué es                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Temperatura`                                                                | Temperatura medida por el termostato.                                                       |
| `Humedad`                                                                    | Humedad interior, cuando el termostato la mide.                                             |
| `Temperatura exterior`                                                       | Temperatura exterior conocida por Resideo (meteorología), cuando se facilita.               |
| `Consigna de calefacción`                                                    | Temperatura que se debe alcanzar al calentar. Modificable.                                  |
| `Consigna de refrigeración`                                                  | Temperatura que no se debe superar al enfriar (aire acondicionado). Modificable.            |
| `Modo`                                                                       | `Apagado`, `Calefacción`, `Refrigeración` o `Automático`, según el termostato. Modificable. |
| `Estado del equipo`                                                          | Lo que hace la calefacción o la refrigeración ahora: inactivo, calentando, enfriando.       |
| `Programación`                                                               | T5, T6, T9, T10: seguir la programación o mantener una temperatura. Modificable.            |
| `Temperatura <habitación>`, `Humedad <habitación>`, `Presencia <habitación>` | Sensores de habitación de los T9/T10: media de la habitación, alguien detectado.            |

- Las temperaturas y consignas están en la unidad del termostato (°C o °F), dentro de los
  límites que da el termostato. Una consigna se redondea a 0,5 °C o 1 °F.
- Cambiar una consigna mientras el termostato sigue su programación crea una **retención
  temporal**, como en el propio termostato: la programación vuelve en su siguiente periodo.
- Las opciones de `Programación` son `Seguir la programación`, `Retención temporal`,
  `Retención permanente`, `Retención hasta una hora` y `Vacaciones`. Las dos últimas se
  muestran pero se ajustan en la aplicación Resideo (necesitan una hora o unas fechas).
- En modo `Automático`, las consignas de calefacción y de refrigeración deben mantener la
  separación que exige el termostato (su zona muerta).
- Un Lyric Round no admite retención de la programación por la API: no tiene la función
  `Programación`. Pasarlo de apagado a `Automático` requiere dos escrituras con tres segundos de
  intervalo (una particularidad de la API de Resideo).
- Un termostato sin conexión muestra la insignia «inaccesible»; los demás, «nube».

## Panel

No hay widget propio: los widgets de Gladys ya muestran un termostato. Añada el widget
**Dispositivos** con las funciones que elija: muestra la temperatura, las consignas con sus
botones, el modo, la programación y los sensores de habitación. Las
funciones de temperatura y humedad también sirven en los widgets de temperatura y humedad de
habitación y en los gráficos.

## Escenas

La integración añade sus propias tarjetas al editor de escenas, en **Integraciones**. Las
funciones del dispositivo también sirven con las tarjetas habituales (una temperatura por
encima de un umbral, ajustar el modo o una consigna).

### Disparadores

- **Termostato sin conexión**: Resideo ya no alcanza un termostato (corte de wifi o de
  corriente). Filtro: el termostato. Variable: el nombre del termostato.
- **Termostato de nuevo en línea**: un termostato señalado sin conexión vuelve a responder.
  Filtro y variable: los mismos.
- **Sesión de Honeywell Home perdida**: Resideo ha rechazado el inicio de sesión; los
  termostatos no se leen hasta volver a hacer clic en **Conectar**. Se dispara una vez.

### Acciones

- **Reanudar la programación del termostato**: anula las retenciones, el termostato vuelve a
  seguir su programación. Todos los termostatos si no se elige ninguno. Resultado: el número de
  termostatos reanudados (un Lyric Round se omite).
- **Mantener una temperatura del termostato**: ajusta la consigna de calefacción (la de
  refrigeración cuando el termostato enfría) hasta el siguiente periodo de la programación, o de
  forma permanente. La temperatura se escribe en la unidad del termostato, `19.5` o `19,5`, y
  puede venir de una variable. Resultado: la consigna aplicada, redondeada y limitada.

### Ideas de escenas

- Cuando la última persona sale de casa: **Mantener una temperatura del termostato** a 16 °C,
  de forma permanente; cuando vuelve la primera: **Reanudar la programación del termostato**.
- **Termostato sin conexión**: enviar un mensaje «{{triggerEvent.data.name}} está sin conexión,
  compruebe la corriente y el wifi».
- **Sesión de Honeywell Home perdida**: enviar un mensaje para volver a conectar la
  integración.
- Una ventana abierta más de 10 minutos: poner `Modo` en `Apagado`; cerrada de nuevo: volver a
  `Calefacción`.

## Cuota de la API y actualización

La integración lee Resideo **cada 5 minutos**: una solicitud para todos sus termostatos, más
una por T9/T10 para sus sensores de habitación. Una orden añade su escritura y una lectura
15 segundos después. Resideo dimensiona la cuota gratuita de una aplicación de desarrollador
para una lectura cada 5 minutos de hasta 20 dispositivos, con un pequeño margen para los
cambios. Si Resideo responde aun así «cuota alcanzada», la integración espera el doble (hasta
30 minutos) y luego vuelve a 5 minutos. Un valor que no cambia se envía igualmente a Gladys cada
6 horas. Reserve una aplicación de desarrollador para Gladys.

## Solución de problemas

- **«Introduzca la clave y el secreto»**: rellene ambos campos y guarde.
- **«Haga clic en Conectar»**: la cuenta aún no está conectada, o la clave ha cambiado: haga
  clic en **Conectar**.
- **La página de Resideo dice que la URI de redirección no es válida**: la Callback URL de su
  aplicación Resideo debe ser exactamente `https://my.gladysassistant.com/redirect/oauth` (o la
  dirección que haya elegido, vea más arriba).
- **«Resideo ha rechazado el inicio de sesión»**: el acceso se ha revocado o ha caducado en
  Resideo. Haga clic de nuevo en **Conectar**. Compruebe que la aplicación sigue activa en
  **My Apps**.
- **«Resideo ha rechazado el código»**: un código solo vale una vez y unos minutos: haga clic de
  nuevo en **Conectar** y pegue rápido la nueva dirección.
- **«Cuota de la API de Resideo alcanzada»**: otro programa usa la misma aplicación de
  desarrollador, o hay muchos termostatos. Espere: las lecturas se espacian solas.
- **Ningún sensor de habitación**: solo los T9 y T10 los tienen, y solo aparecen las
  habitaciones con sensor (la habitación del termostato es el propio termostato). Una habitación
  añadida más tarde aparece tras **Actualizar** en la pestaña **Descubrir**.
- **Probar la conexión** (pantalla de configuración) lee Resideo al momento y lista cada
  termostato con su temperatura y su modo.
- Más detalles en los registros con `LOG_LEVEL=debug`; nunca se escribe en ellos un token ni un
  secreto.

## Límites

- Solo nube: sin control local, y nada funciona cuando la nube de Resideo o su acceso a Internet
  falla.
- Los cambios hechos en otro lugar (termostato, aplicación Resideo) llegan a Gladys en menos de
  5 minutos.
- No cubierto: el modo del ventilador, los ajustes de vacaciones, la propia programación, los
  detectores de fugas y las cámaras de Resideo, los sistemas Total Connect Comfort y evohome.
- Los sensores de habitación dan la media de su habitación. Resideo documenta su temperatura en
  °F: para un termostato en °C, un valor de habitación superior a 45 se toma por °F y se
  convierte.
- Los nombres de las funciones se fijan al añadir el dispositivo: una habitación renombrada
  conserva su nombre anterior en Gladys.
