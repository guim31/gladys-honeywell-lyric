# Honeywell Home (Lyric)

Cette intégration amène dans Gladys vos thermostats Wi-Fi **Honeywell Home / Resideo** : Lyric
Round, T5, T6, T9 et T10, ainsi que les capteurs de pièce des T9/T10. Elle passe par l'API
cloud officielle de Resideo, avec une application développeur gratuite que vous créez
vous-même, comme l'intégration `lyric` de Home Assistant. Vous obtenez la température,
l'humidité, les consignes, le mode, ce que fait l'équipement et le programme de chaque
thermostat, et vous les pilotez depuis le tableau de bord et les scènes.

Elle ne concerne pas les anciens thermostats Honeywell **Total Connect Comfort** (une autre
API), ni les systèmes evohome.

Cette intégration n'est pas affiliée à Resideo ni à Honeywell. Développée sans le matériel :
vos retours sont les bienvenus sur [GitHub](https://github.com/guim31/gladys-honeywell-lyric/issues).

## Ce qu'il vous faut

- Gladys 5.1 ou plus récent, avec un accès à Internet.
- Un thermostat qui fonctionne déjà dans l'application **Resideo** (Honeywell Home).
- Un compte gratuit sur le [site développeur de Resideo](https://developer.honeywellhome.com/),
  pour créer votre propre application : Resideo ne fournit pas de clé commune aux logiciels
  tiers.

## Mise en place

### 1. Créez votre application développeur Resideo

1. Sur [developer.honeywellhome.com](https://developer.honeywellhome.com/), créez un compte
   (n'importe quelle adresse e-mail), puis connectez-vous.
2. Ouvrez **My Apps**, puis **Create New App**.
3. **App Name** : ce que vous voulez, par exemple `Gladys`.
4. **Callback URL** : `https://my.gladysassistant.com/redirect/oauth` (la page HTTPS par
   laquelle Gladys vous ramène sur votre propre Gladys après la connexion).
5. Enregistrez. Ouvrez votre application dans **My Apps** : elle affiche une **Consumer Key**
   et un **Consumer Secret**. Une nouvelle application peut rester « en attente » un moment avant
   que Resideo l'accepte.

### 2. Saisissez la clé et le secret

Dans Gladys, ouvrez **Intégrations → Honeywell Home (Lyric) → Configuration**, collez la
**Consumer key (clé)** et le **Consumer secret (secret)**, choisissez la **langue des noms de
fonctionnalités**, puis **Enregistrez**.

### 3. Connectez votre compte

Cliquez sur **Connecter** à côté de **Compte Honeywell Home**. Resideo ouvre sa page de
connexion : connectez-vous avec le compte de l'application Resideo, cochez les thermostats que
Gladys peut utiliser et acceptez. Vous revenez sur Gladys et, quelques secondes plus tard,
l'état indique que l'intégration est connectée. Les thermostats sont alors dans l'onglet
**Découverte** : ajoutez-les.

Sous **Connecter**, l'écran de configuration affiche l'**adresse de redirection à déclarer
dans votre application développeur** : `https://my.gladysassistant.com/redirect/oauth`. Si vous
accédez à Gladys en HTTPS et cochez **Utiliser plutôt l'adresse de mon instance**, il affiche à
la place l'adresse de votre instance : saisissez alors celle-ci comme Callback URL de votre
application Resideo.

### Si Connecter ne revient pas sur Gladys

Passez par le code collé :

1. Dans votre application Resideo, réglez la **Callback URL** sur `https://localhost/`.
2. Dans Gladys, saisissez la même adresse dans **URL de rappel (code collé)**, enregistrez,
   puis cliquez sur **Connecter**.
3. Après la connexion, le navigateur affiche une page d'erreur sur `localhost` : c'est normal.
   Copiez toute l'adresse de la barre d'adresse (elle contient `?code=…`).
4. Dans les minutes qui suivent (un code n'est valable qu'une fois et peu de temps),
   collez-la dans l'action **Coller le code d'autorisation** de l'écran de configuration et
   lancez-la. La réponse est par exemple « Connecté à Resideo : 2 thermostat(s). ».

Les jetons sont conservés dans `/data` : vous ne vous reconnectez que si Resideo les refuse.

## L'appareil de chaque thermostat

Un appareil par thermostat, nommé comme dans l'application Resideo. Ses fonctionnalités
dépendent du modèle :

| Fonctionnalité                                                | Ce que c'est                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Température`                                                 | Température mesurée par le thermostat.                                            |
| `Humidité`                                                    | Humidité intérieure, quand le thermostat la mesure.                               |
| `Température extérieure`                                      | Température extérieure connue de Resideo (météo), quand elle est fournie.         |
| `Consigne chauffage`                                          | Température à atteindre en chauffage. Modifiable.                                 |
| `Consigne climatisation`                                      | Température à ne pas dépasser en climatisation. Modifiable.                       |
| `Mode`                                                        | `Arrêt`, `Chauffage`, `Climatisation` ou `Auto`, selon le thermostat. Modifiable. |
| `État de l'équipement`                                        | Ce que fait le chauffage ou la clim à l'instant : inactif, chauffe, refroidit.    |
| `Programme`                                                   | T5, T6, T9, T10 : suivre le programme ou maintenir une température. Modifiable.   |
| `Température <pièce>`, `Humidité <pièce>`, `Présence <pièce>` | Capteurs de pièce des T9/T10 : moyenne de la pièce, quelqu'un détecté.            |

- Températures et consignes sont dans l'unité du thermostat (°C ou °F), dans les bornes que
  donne le thermostat. Une consigne est arrondie à 0,5 °C ou 1 °F.
- Changer une consigne pendant que le thermostat suit son programme crée une **dérogation
  temporaire**, comme sur le thermostat lui-même : le programme reprend à sa période suivante.
- Les options de `Programme` sont `Suivre le programme`, `Dérogation temporaire`,
  `Dérogation permanente`, `Dérogation jusqu'à une heure` et `Vacances`. Les deux dernières
  s'affichent mais se règlent dans l'application Resideo (il leur faut une heure ou des dates).
- En mode `Auto`, les consignes de chauffage et de climatisation doivent rester séparées de
  l'écart qu'exige le thermostat (sa zone neutre).
- Un Lyric Round n'a pas de dérogation au programme par l'API : il n'a pas de fonctionnalité
  `Programme`. Le passer de l'arrêt à `Auto` demande deux écritures à trois secondes
  d'intervalle (une particularité de l'API Resideo).
- Un thermostat hors ligne affiche le badge « injoignable » ; les autres affichent « cloud ».

## Tableau de bord

Pas de widget dédié : les widgets de Gladys savent déjà montrer un thermostat. Ajoutez le
widget **Appareils** avec les fonctionnalités de votre choix : il montre la température, les
consignes avec leurs boutons, le mode, le programme et les capteurs de pièce.
Les fonctionnalités de température et d'humidité vont aussi dans les widgets de température
et d'humidité de pièce et dans les graphiques.

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes, dans **Intégrations**. Les
fonctionnalités de l'appareil marchent aussi avec les cartes habituelles (une température
au-dessus d'un seuil, régler le mode ou une consigne).

### Déclencheurs

- **Thermostat hors ligne** : Resideo ne joint plus un thermostat (coupure Wi-Fi ou de
  courant). Filtre : le thermostat. Variable : le nom du thermostat.
- **Thermostat de nouveau en ligne** : un thermostat signalé hors ligne répond de nouveau.
  Filtre et variable : les mêmes.
- **Connexion Honeywell Home perdue** : Resideo a refusé la connexion ; les thermostats ne
  sont plus lus avant un nouveau clic sur **Connecter**. Déclenché une fois.

### Actions

- **Reprendre le programme du thermostat** : annule les dérogations, le thermostat suit de
  nouveau son programme. Tous les thermostats si aucun n'est choisi. Résultat : le nombre de
  thermostats repris (un Lyric Round est ignoré).
- **Maintenir une température de thermostat** : règle la consigne de chauffage (de
  climatisation quand le thermostat climatise) jusqu'à la prochaine période du programme, ou
  en permanence. La température se saisit dans l'unité du thermostat, `19.5` ou `19,5`, et
  peut venir d'une variable. Résultat : la consigne appliquée, arrondie et bornée.

### Idées de scènes

- Quand la dernière personne quitte la maison : **Maintenir une température de thermostat**
  à 16 °C, en permanence ; quand la première revient : **Reprendre le programme du
  thermostat**.
- **Thermostat hors ligne** : envoyer un message « {{triggerEvent.data.name}} est hors ligne,
  vérifiez le courant et le Wi-Fi ».
- **Connexion Honeywell Home perdue** : envoyer un message pour reconnecter l'intégration.
- Une fenêtre ouverte plus de 10 minutes : régler `Mode` sur `Arrêt` ; refermée : le remettre
  sur `Chauffage`.

## Quota de l'API et rafraîchissement

L'intégration lit Resideo **toutes les 5 minutes** : une requête pour tous vos thermostats,
plus une par T9/T10 pour ses capteurs de pièce. Une commande ajoute son écriture et une lecture
15 secondes plus tard. Resideo dimensionne le quota gratuit d'une application développeur
pour une lecture toutes les 5 minutes de 20 appareils au plus, avec une petite marge pour les
changements. Si Resideo répond malgré tout « quota atteint », l'intégration attend deux fois
plus longtemps (jusqu'à 30 minutes), puis revient à 5 minutes. Une valeur qui ne change pas est
tout de même renvoyée à Gladys toutes les 6 heures. Réservez une application développeur à
Gladys.

## Dépannage

- **« Saisissez la clé et le secret »** : remplissez les deux champs et enregistrez.
- **« Cliquez sur Connecter »** : le compte n'est pas encore connecté, ou la clé a changé :
  cliquez sur **Connecter**.
- **La page Resideo dit que l'URI de redirection est invalide** : la Callback URL de votre
  application Resideo doit être exactement `https://my.gladysassistant.com/redirect/oauth` (ou
  l'adresse que vous avez choisie, voir plus haut).
- **« Resideo a refusé la connexion »** : l'accès a été révoqué ou a expiré chez Resideo.
  Cliquez de nouveau sur **Connecter**. Vérifiez que l'application est toujours active dans
  **My Apps**.
- **« Resideo a refusé le code »** : un code n'est valable qu'une fois et quelques minutes :
  cliquez de nouveau sur **Connecter** et collez vite la nouvelle adresse.
- **« Quota de l'API Resideo atteint »** : un autre logiciel utilise la même application
  développeur, ou les thermostats sont nombreux. Patientez : les lectures s'espacent d'elles-mêmes.
- **Aucun capteur de pièce** : seuls les T9 et T10 en ont, et seules les pièces avec un capteur
  apparaissent (la pièce du thermostat, c'est le thermostat lui-même). Une pièce ajoutée plus
  tard apparaît après **Mettre à jour** dans l'onglet **Découverte**.
- **Tester la connexion** (écran de configuration) lit Resideo aussitôt et liste chaque
  thermostat avec sa température et son mode.
- Plus de détails dans les logs avec `LOG_LEVEL=debug` ; aucun jeton ni secret n'y est jamais
  écrit.

## Limites

- Cloud uniquement : pas de pilotage local, et rien ne marche quand le cloud Resideo ou votre
  accès Internet est en panne.
- Les changements faits ailleurs (thermostat, application Resideo) arrivent dans Gladys en
  moins de 5 minutes.
- Non couverts : le mode de ventilation, les réglages de vacances, le programme lui-même, les
  détecteurs de fuite et caméras Resideo, les systèmes Total Connect Comfort et evohome.
- Les capteurs de pièce donnent la moyenne de leur pièce. Resideo documente leur température
  en °F : pour un thermostat en °C, une valeur de pièce au-dessus de 45 est prise pour des °F et
  convertie.
- Les noms des fonctionnalités sont fixés à l'ajout de l'appareil : une pièce renommée garde
  son ancien nom dans Gladys.
